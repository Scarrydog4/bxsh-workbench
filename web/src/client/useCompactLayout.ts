import { useEffect, useState } from 'react'
/** New tables keep their principal fields visible on phones; optional columns stay in the shared column menu. */
export function useCompactLayout() {
  const [compact,setCompact]=useState(false)
  useEffect(()=>{const media=window.matchMedia('(max-width: 639px)'),update=()=>setCompact(media.matches);update();media.addEventListener('change',update);return()=>media.removeEventListener('change',update)},[])
  return compact
}
