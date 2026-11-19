import React from 'react';
import { Layers } from 'lucide-react';

/** Single brand lockup shared by authentication and application navigation. */
export default function BrandLockup({ compact = false }: { compact?: boolean }) {
  return (
    <div className={`flex flex-col items-center text-teal-400 ${compact ? 'scale-[0.78] origin-center' : ''}`}>
      <Layers className="h-6 w-6 mb-2" aria-hidden="true" />
      <div className="flex flex-col items-stretch gap-1">
        <span className="text-2xl sm:text-[28px] leading-none font-bold tracking-tight whitespace-nowrap">DocFlow Pro</span>
        <span className="flex w-full items-center justify-between whitespace-nowrap text-[10px] sm:text-[11px] leading-tight font-mono uppercase" aria-label="Gestión Documental">
          {"GESTIÓN DOCUMENTAL".split("").map((letter, index) => (
            <span key={index} aria-hidden="true">{letter === " " ? "\u00a0" : letter}</span>
          ))}
        </span>
      </div>
    </div>
  );
}
