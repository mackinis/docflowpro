import React from 'react';
import { FileText, X } from 'lucide-react';

export type PreviewDocument = {url:string;name:string;mime:string};

export default function DocumentPreviewViewer({document:doc,onClose}:{document:PreviewDocument;onClose:()=>void}) {
  return <div className="fixed inset-0 z-[100] bg-slate-950/85 backdrop-blur-sm flex items-center justify-center p-4" role="dialog" aria-modal="true" aria-label="Visor de documento">
    <div className="w-full max-w-6xl h-[90vh] rounded-2xl border border-slate-600 bg-slate-900 shadow-2xl flex flex-col overflow-hidden">
      <div className="flex items-center justify-between gap-4 px-5 py-3 border-b border-slate-700 text-white">
        <div className="flex items-center gap-2 min-w-0"><FileText className="w-5 h-5 text-indigo-400 shrink-0"/><span className="font-semibold truncate">{doc.name}</span></div>
        <button onClick={onClose} className="rounded-lg p-2 hover:bg-slate-700" aria-label="Cerrar visor"><X className="w-5 h-5"/></button>
      </div>
      <div className="flex-1 min-h-0 bg-slate-800 flex items-center justify-center relative overflow-hidden">
        {doc.mime.includes('pdf') || doc.name.toLowerCase().endsWith('.pdf') || doc.mime.startsWith('text/') || /\.txt$/i.test(doc.name) ?
          <><iframe src={doc.url} title={doc.name} className="w-full h-full border-0 bg-white"/>{(doc.mime.includes("pdf") || doc.name.toLowerCase().endsWith(".pdf")) && <div aria-hidden="true" className="pointer-events-none absolute right-0 top-[57px] bottom-0 w-[13px] bg-[#292929]" />}</> :
          doc.mime.startsWith('image/') ? <img src={doc.url} alt={doc.name} className="max-w-full max-h-full object-contain"/> :
          <p className="text-slate-200 text-sm p-6">Este formato no admite vista previa en el navegador. Podés usar el botón Descargar.</p>}
      </div>
    </div>
  </div>;
}
