'use client';

import React, { useState, useEffect, useRef } from 'react';
import { MessageCircle, X } from 'lucide-react';
import { cn } from '@/lib/utils';

export default function WhatsAppHelp() {
  const [position, setPosition] = useState({ x: 20, y: 20 }); // Distances from bottom-right
  const [isDragging, setIsDragging] = useState(false);
  const [isVisible, setIsVisible] = useState(true);
  const offset = useRef({ x: 0, y: 0 });
  const buttonRef = useRef<HTMLDivElement>(null);

  // Load initial position from bottom-right
  useEffect(() => {
    const savedPos = localStorage.getItem('wa-help-pos');
    if (savedPos) {
      try {
        setPosition(JSON.parse(savedPos));
      } catch (e) {
        console.error("Failed to load help button position");
      }
    }
  }, []);

  const handlePointerDown = (e: React.PointerEvent) => {
    if (!buttonRef.current) return;
    setIsDragging(true);
    
    // Calculate offset from the click point to the button's right/bottom edge
    const rect = buttonRef.current.getBoundingClientRect();
    offset.current = {
      x: window.innerWidth - e.clientX - position.x,
      y: window.innerHeight - e.clientY - position.y
    };
    
    buttonRef.current.setPointerCapture(e.pointerId);
  };

  const handlePointerMove = (e: React.PointerEvent) => {
    if (!isDragging) return;

    // Calculate new distances from bottom and right
    const newX = window.innerWidth - e.clientX - offset.current.x;
    const newY = window.innerHeight - e.clientY - offset.current.y;

    // Constrain within viewport
    const boundedX = Math.max(10, Math.min(window.innerWidth - 70, newX));
    const boundedY = Math.max(10, Math.min(window.innerHeight - 70, newY));

    setPosition({ x: boundedX, y: boundedY });
  };

  const handlePointerUp = () => {
    setIsDragging(false);
    localStorage.setItem('wa-help-pos', JSON.stringify(position));
  };

  if (!isVisible) return null;

  const handleClick = (e: React.MouseEvent) => {
    // If we just finished a drag, don't open the link
    if (isDragging) {
      e.preventDefault();
      return;
    }
    window.open('https://wa.me/254748809701', '_blank');
  };

  return (
    <div
      ref={buttonRef}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      style={{
        bottom: `${position.y}px`,
        right: `${position.x}px`,
        touchAction: 'none'
      }}
      className={cn(
        "fixed z-[9999] flex items-center group",
        isDragging ? "cursor-grabbing" : "cursor-grab"
      )}
    >
      <div className="absolute right-full mr-3 opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none hidden md:block">
        <div className="bg-white px-4 py-2 rounded-2xl shadow-2xl border border-zinc-100 whitespace-nowrap">
          <p className="text-zinc-900 font-black text-[10px] uppercase tracking-widest">Need help? Chat with Admin</p>
        </div>
      </div>
      
      <button
        onClick={handleClick}
        className={cn(
          "h-14 w-14 md:h-16 md:w-16 bg-[#25D366] text-white rounded-full shadow-2xl flex items-center justify-center transition-all hover:scale-110 active:scale-95 border-4 border-white",
          isDragging && "scale-105 opacity-80"
        )}
      >
        <MessageCircle className="h-7 w-7 md:h-8 md:w-8 fill-white/20" />
        <span className="absolute -top-1 -right-1 flex h-4 w-4">
          <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-white opacity-75"></span>
          <span className="relative inline-flex rounded-full h-4 w-4 bg-white border-2 border-[#25D366]"></span>
        </span>
      </button>
      
      <button 
        onClick={(e) => { e.stopPropagation(); setIsVisible(false); }}
        className="absolute -top-2 -left-2 bg-zinc-900 text-white rounded-full p-1 opacity-0 group-hover:opacity-100 transition-opacity hover:bg-destructive"
      >
        <X className="h-3 w-3" />
      </button>
    </div>
  );
}
