'use client';

import { useState } from 'react';
import { ACCENT_COLOR } from '@/lib/meta';
import type { FeedbackDir } from '@/lib/types';

interface FeedbackNoteModalProps {
  open: boolean;
  direction: FeedbackDir;
  initialNote?: string;
  title?: string;
  onClose: () => void;
  onSubmit: (note: string) => void;
}

export default function FeedbackNoteModal({
  open,
  direction,
  initialNote = '',
  title,
  onClose,
  onSubmit,
}: FeedbackNoteModalProps) {
  const [note, setNote] = useState(initialNote);

  if (!open || !direction) return null;

  const heading =
    title ??
    (direction === 'down'
      ? 'What went wrong?'
      : 'Optional note (helps future heals)');

  return (
    <div className="fixed inset-0 bg-[rgba(20,22,27,0.5)] z-[500] flex items-center justify-center">
      <div className="w-[480px] bg-white rounded-xl shadow-[0_24px_60px_rgba(0,0,0,0.25)] p-5">
        <div className="text-[15px] font-bold mb-1">
          {direction === 'up' ? '👍' : '👎'} {heading}
        </div>
        <div className="text-[12px] text-[#9CA3AF] mb-3">
          {direction === 'down'
            ? 'Your note becomes a constraint for future heals in this repo.'
            : 'A short note is worth ten bare thumbs.'}
        </div>
        <textarea
          value={note}
          onChange={(e) => setNote(e.target.value.slice(0, 2000))}
          rows={4}
          placeholder={direction === 'down' ? 'e.g. patch weakened the assertion on line 42' : 'Optional…'}
          className="w-full box-border py-2.5 px-3 border border-[#E4E6EB] rounded-lg text-[13px] outline-none font-[inherit] resize-y"
          autoFocus
        />
        <div className="flex justify-end gap-2 mt-4">
          <div
            onClick={onClose}
            className="text-[12.5px] font-semibold text-[#4B5563] py-2 px-4 border border-[#E4E6EB] rounded-lg cursor-pointer"
          >
            Cancel
          </div>
          <div
            onClick={() => {
              if (direction === 'down' && !note.trim()) return;
              onSubmit(note.trim());
            }}
            className="text-[12.5px] font-bold text-white py-2 px-4 rounded-lg cursor-pointer"
            style={{
              background: direction === 'down' && !note.trim() ? '#C7C2FA' : ACCENT_COLOR,
            }}
          >
            Submit
          </div>
        </div>
      </div>
    </div>
  );
}
