import React, { useEffect, useState } from 'react';
import { FileText, X } from 'lucide-react';

export type PreviewDocument = {url:string;name:string;mime:string};

// A TXT file has no PDF toolbar in the browser. Produce an in-memory PDF preview
// so every document uses the same native PDF viewer without changing the source file.
function textToPdf(value:string):Blob {
  const lines:string[]=[];
  for(const line of value.replace(/\r\n?/g,'\n').replace(/\t/g,'    ').split('\n')){
    if(!line.length){lines.push('');continue;}
    for(let i=0;i<line.length;i+=100)lines.push(line.slice(i,i+100));
  }
  const pages:string[][]=[];
  for(let i=0;i<lines.length;i+=72)pages.push(lines.slice(i,i+72));
  if(!pages.length)pages.push([]);
  const objects:string[]=['',''];
  const pageIds:number[]=[];
  const add=(s:string)=>{objects.push(s);return objects.length;};
  const fontId=add('<< /Type /Font /Subtype /Type1 /BaseFont /Courier /Encoding /WinAnsiEncoding >>');
  const encode=(s:string)=>s.replace(/[^\x20-\x7e\u00a0-\u00ff]/g,'?').replace(/\\/g,'\\\\').replace(/\(/g,'\\(').replace(/\)/g,'\\)');
  for(const page of pages){
    const stream='0.10 0.15 0.23 rg 0 0 595 842 re f\n1 1 1 rg BT /F1 9 Tf 12 TL 36 805 Td\n'+page.map((line,i)=> (i?'T* ':'')+'('+encode(line)+') Tj').join('\n')+'\nET';
    const streamId=add('<< /Length '+stream.length+' >>\nstream\n'+stream+'\nendstream');
    const pageId=add('<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 '+fontId+' 0 R >> >> /Contents '+streamId+' 0 R >>');
    pageIds.push(pageId);
  }
  objects[0]='<< /Type /Catalog /Pages 2 0 R >>';
  objects[1]='<< /Type /Pages /Kids ['+pageIds.map(id=>id+' 0 R').join(' ')+'] /Count '+pageIds.length+' >>';
  let pdf='%PDF-1.4\n%\xE2\xE3\xCF\xD3\n';
  const offsets=[0];
  objects.forEach((obj,i)=>{offsets.push(pdf.length);pdf+=(i+1)+' 0 obj\n'+obj+'\nendobj\n';});
  const xref=pdf.length;
  pdf+='xref\n0 '+(objects.length+1)+'\n0000000000 65535 f \n'+offsets.slice(1).map(o=>String(o).padStart(10,'0')+' 00000 n \n').join('');
  pdf+='trailer\n<< /Size '+(objects.length+1)+' /Root 1 0 R >>\nstartxref\n'+xref+'\n%%EOF';
  return new Blob([Uint8Array.from(pdf,c=>c.charCodeAt(0))],{type:'application/pdf'});
}

export default function DocumentPreviewViewer({document:doc,onClose}:{document:PreviewDocument;onClose:()=>void}) {
  const isText=doc.mime.startsWith('text/') || /\.txt$/i.test(doc.name);
  const [pdfUrl,setPdfUrl]=useState<string|null>(null);
  const [error,setError]=useState('');
  useEffect(()=>{
    if(!isText){setPdfUrl(null);return;}
    const controller=new AbortController();
    let objectUrl:string|null=null;
    setPdfUrl(null);setError('');
    fetch(doc.url,{signal:controller.signal})
      .then(r=>{if(!r.ok)throw new Error('No se pudo leer el documento.');return r.text();})
      .then(text=>{if(controller.signal.aborted)return;objectUrl=URL.createObjectURL(textToPdf(text));setPdfUrl(objectUrl);})
      .catch(e=>{if(e.name!=='AbortError')setError('No se pudo preparar la vista previa.');});
    return ()=>{controller.abort();if(objectUrl)URL.revokeObjectURL(objectUrl);};
  },[doc.url,isText]);
  const isPdf=doc.mime.includes('pdf') || /\.pdf$/i.test(doc.name);
  const viewerUrl=isText?pdfUrl:doc.url;
  return <div className="fixed inset-0 z-[100] bg-slate-950/85 backdrop-blur-sm flex items-center justify-center p-4" role="dialog" aria-modal="true" aria-label="Visor de documento">
    <div className="w-full max-w-6xl h-[90vh] rounded-2xl border border-slate-600 bg-slate-900 shadow-2xl flex flex-col overflow-hidden">
      <div className="flex items-center justify-between gap-4 px-5 py-3 border-b border-slate-700 text-white">
        <div className="flex items-center gap-2 min-w-0"><FileText className="w-5 h-5 text-indigo-400 shrink-0"/><span className="font-semibold truncate">{doc.name}</span></div>
        <button onClick={onClose} className="rounded-lg p-2 hover:bg-slate-700" aria-label="Cerrar visor"><X className="w-5 h-5"/></button>
      </div>
      <div className="flex-1 min-h-0 bg-slate-800 flex items-center justify-center relative overflow-hidden">
        {(isPdf||isText) ? (viewerUrl ? <><iframe src={viewerUrl} title={doc.name} className="w-full h-full border-0 bg-white"/><div aria-hidden="true" className="pointer-events-none absolute right-0 top-[57px] bottom-0 w-[13px] bg-[#292929]" /></> : <p className="text-slate-100">{error||'Preparando vista previa…'}</p>) :
          doc.mime.startsWith('image/') ? <img src={doc.url} alt={doc.name} className="max-w-full max-h-full object-contain"/> :
          <p className="text-slate-200 text-sm p-6">Este formato no admite vista previa en el navegador. Podés usar el botón Descargar.</p>}
      </div>
    </div>
  </div>;
}
