import { SettlementNote } from './SettlementNote'
import { Thumbs } from './ImageViewer'

export function FinancialNote({ note, proof, onNote, onProof, onReading, disabled, required = false }: {
  note: string; proof?: string; onNote: (note: string) => void; onProof: (proof?: string) => void
  onReading: (reading: boolean) => void; disabled?: boolean; required?: boolean
}) {
  return <SettlementNote note={note} shots={proof ? [proof] : []} onNote={onNote} onShots={shots => onProof(shots[0])} disabled={disabled} onReading={onReading} label="金额备注" placeholder={required ? '备注必填，可写文字或直接粘贴截图' : '备注（可空），可写文字或直接粘贴截图'} maxImages={1} maxLength={500} />
}

export function FinancialNoteView({ note, proof }: { note?: string; proof?: string | null }) {
  if (!note && !proof) return null
  return <div className="mt-1.5 space-y-1.5 text-sm">
    {note && <p className="whitespace-pre-wrap break-words">{note}</p>}
    {proof && <Thumbs pics={[{ src: proof, name: '金额备注.webp' }]} imgClass="h-16 w-16" />}
  </div>
}
