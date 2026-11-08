import { withMaterialUpload } from '@/server/material-upload'
import { json, route, bad } from '@/server/http'
import { listMaterials, materialInput, readBody, saveMaterial, requireMaterialMaintainer } from '@/server/work-materials'

export const GET = route(async (req, c) => json(await listMaterials(c, new URL(req.url).searchParams.get('kind') === 'talk' ? 'talk' : 'case')))
const save = (create: boolean) => route(async (req, c) => {
  requireMaterialMaintainer(c)
  if (req.headers.get('content-type')?.startsWith('multipart/form-data')) {
    await withMaterialUpload(req,async (form,attachment)=>{
      const data = materialInput.safeParse({ ...Object.fromEntries(form), pictures: form.has('pictures') ? form.getAll('pictures') : undefined, removeFile: form.get('removeFile') === 'true' })
      if (!data.success) throw bad('请填写文案并检查分类')
      await saveMaterial(c,data.data,create,attachment)
    })
  } else {
    await saveMaterial(c, await readBody(req, materialInput), create)
  }
  return json({ ok: true })
})
export const POST = save(true)
export const PUT = save(false)
