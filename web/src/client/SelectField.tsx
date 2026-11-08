import { Children, Fragment, isValidElement, type ReactNode, type SelectHTMLAttributes } from 'react'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'

/** 统一选择器：保留表单值，选项由 Radix 负责焦点与键盘交互。 */
export function SelectField({children,value,onChange,className,id,disabled,required,name,...props}:SelectHTMLAttributes<HTMLSelectElement>) {
 const options:{value:string;label:ReactNode;disabled?:boolean}[]=[]
 const visit=(nodes:ReactNode)=>Children.forEach(nodes,node=>{
  if(!isValidElement<{value?:string|number;children?:ReactNode;disabled?:boolean}>(node))return
  if(node.type==='option')options.push({value:String(node.props.value??node.props.children??''),label:node.props.children,disabled:node.props.disabled})
  else if(node.type===Fragment||node.type==='optgroup')visit(node.props.children)
 })
 visit(children)
 // Radix 不接受空字符串选项；编码还保证不会与真实业务 id 冲突。
 const key=(v:string)=>'value:'+v
 return <Select name={name} value={key(String(value??''))} disabled={disabled} required={required} onValueChange={v=>{
  const target={value:v.slice(6),name:name??'',id:id??''} as HTMLSelectElement
  onChange?.({target,currentTarget:target} as React.ChangeEvent<HTMLSelectElement>)
 }}><SelectTrigger id={id} aria-label={props['aria-label']} aria-labelledby={props['aria-labelledby']} aria-describedby={props['aria-describedby']} aria-busy={props['aria-busy']} aria-invalid={props['aria-invalid']} title={props.title} className={className}><SelectValue/></SelectTrigger><SelectContent>{options.map(o=><SelectItem key={o.value} value={key(o.value)} disabled={o.disabled}>{o.label}</SelectItem>)}</SelectContent></Select>
}
