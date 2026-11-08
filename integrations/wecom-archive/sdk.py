"""Thin ctypes binding to Tencent's official Linux C SDK v3 (OpenSSL 3)."""
import base64
import ctypes as c
import json
from pathlib import Path

from cryptography.hazmat.primitives import serialization
from cryptography.hazmat.primitives.asymmetric import padding, rsa


class ArchiveError(Exception):
    """Safe error code: never include credentials or message contents."""


def load_keys(paths):
    keys = {}
    for version, path in paths.items():
        key = serialization.load_pem_private_key(Path(path).read_bytes(), password=None)
        if not isinstance(key, rsa.RSAPrivateKey) or key.key_size != 2048:
            raise ArchiveError('invalid_rsa_key')
        keys[str(version)] = key
    return keys


class FinanceSDK:
    def __init__(self, library, corp_id, secret, timeout=10):
        self.lib = c.CDLL(str(library))
        self.timeout = timeout
        self.handle = None
        signatures = {
            'NewSdk': (c.c_void_p, []),
            'Init': (c.c_int, [c.c_void_p, c.c_char_p, c.c_char_p]),
            'DestroySdk': (None, [c.c_void_p]),
            'NewSlice': (c.c_void_p, []),
            'FreeSlice': (None, [c.c_void_p]),
            'GetContentFromSlice': (c.c_void_p, [c.c_void_p]),
            'GetSliceLen': (c.c_int, [c.c_void_p]),
            'GetChatData': (c.c_int, [c.c_void_p, c.c_ulonglong, c.c_uint, c.c_char_p, c.c_char_p, c.c_int, c.c_void_p]),
            'DecryptData': (c.c_int, [c.c_char_p, c.c_char_p, c.c_void_p]),
            'NewMediaData': (c.c_void_p, []),
            'FreeMediaData': (None, [c.c_void_p]),
            'GetMediaData': (c.c_int, [c.c_void_p, c.c_char_p, c.c_char_p, c.c_char_p, c.c_char_p, c.c_int, c.c_void_p]),
            'GetData': (c.c_void_p, [c.c_void_p]),
            'GetDataLen': (c.c_int, [c.c_void_p]),
            'GetOutIndexBuf': (c.c_void_p, [c.c_void_p]),
            'GetIndexLen': (c.c_int, [c.c_void_p]),
            'IsMediaDataFinish': (c.c_int, [c.c_void_p]),
        }
        for name, (restype, args) in signatures.items():
            fn = getattr(self.lib, name)
            fn.restype, fn.argtypes = restype, args
        self.handle = self.lib.NewSdk()
        if not self.handle:
            raise ArchiveError('sdk_allocation_failed')
        code = self.lib.Init(self.handle, corp_id.encode(), secret.encode())
        if code:
            self.close()
            raise ArchiveError(f'sdk_init_{code}')

    def close(self):
        if self.handle:
            self.lib.DestroySdk(self.handle)
            self.handle = None

    def _json(self, fn, *args):
        ptr = self.lib.NewSlice()
        if not ptr:
            raise ArchiveError('slice_allocation_failed')
        try:
            code = fn(*args, ptr)
            if code:
                raise ArchiveError(f'sdk_{fn.__name__}_{code}')
            data = c.string_at(self.lib.GetContentFromSlice(ptr), self.lib.GetSliceLen(ptr))
            return json.loads(data.rstrip(b'\0'))
        finally:
            self.lib.FreeSlice(ptr)

    def chat(self, seq, limit=100):
        result = self._json(self.lib.GetChatData, self.handle, int(seq), limit, b'', b'', self.timeout)
        if result.get('errcode') != 0:
            raise ArchiveError(f'wecom_{result.get("errcode", "invalid_response")}')
        if not isinstance(result.get('chatdata'), list):
            raise ArchiveError('invalid_chatdata')
        return result['chatdata']

    def decrypt(self, envelope, keys):
        key = keys.get(str(envelope['publickey_ver']))
        if key is None:
            raise ArchiveError(f'missing_key_version_{envelope["publickey_ver"]}')
        try:
            random_key = key.decrypt(base64.b64decode(envelope['encrypt_random_key'], validate=True), padding.PKCS1v15())
        except (ValueError, TypeError) as error:
            raise ArchiveError('rsa_decrypt_failed') from error
        return self._json(self.lib.DecryptData, random_key, envelope['encrypt_chat_msg'].encode())

    def media(self, sdkfileid, index):
        ptr = self.lib.NewMediaData()
        if not ptr:
            raise ArchiveError('media_allocation_failed')
        try:
            code = self.lib.GetMediaData(self.handle, index, sdkfileid.encode(), b'', b'', self.timeout, ptr)
            if code:
                raise ArchiveError(f'sdk_GetMediaData_{code}')
            data = c.string_at(self.lib.GetData(ptr), self.lib.GetDataLen(ptr))
            index = c.string_at(self.lib.GetOutIndexBuf(ptr), self.lib.GetIndexLen(ptr)).rstrip(b'\0')
            return data, index, self.lib.IsMediaDataFinish(ptr) == 1
        finally:
            self.lib.FreeMediaData(ptr)
