'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useConsoleStore } from '@/store/useConsoleStore';
import { ACCENT_COLOR } from '@/lib/meta';

interface InitRepoModalProps {
  open: boolean;
  onClose: () => void;
}

export default function InitRepoModal({ open, onClose }: InitRepoModalProps) {
  const router = useRouter();
  const initRepo = useConsoleStore((s) => s.initRepo);
  const showToast = useConsoleStore((s) => s.showToast);
  const [name, setName] = useState('');
  const [localPath, setLocalPath] = useState('');
  const [busy, setBusy] = useState(false);

  if (!open) return null;

  const handleSubmit = async () => {
    if (!name.trim() || !localPath.trim()) return;
    setBusy(true);
    try {
      const manifestId = await initRepo(name.trim(), localPath.trim());
      onClose();
      router.push(`/manifest/${manifestId}`);
    } catch (err) {
      showToast((err as Error).message, 4000);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-[rgba(20,22,27,0.5)] z-[500] flex items-center justify-center">
      <div className="w-[520px] bg-white rounded-xl shadow-[0_24px_60px_rgba(0,0,0,0.25)] p-5">
        <div className="text-[15px] font-bold mb-1">Register repo</div>
        <div className="text-[12px] text-[#9CA3AF] mb-4">
          Mirrors <code className="font-mono">agent init &lt;path&gt; --name &lt;label&gt;</code>
        </div>
        <div className="flex flex-col gap-3">
          <div>
            <div className="text-[12px] font-bold text-[#4B5563] mb-1">Display name</div>
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="shop-tests"
              className="w-full box-border py-2.5 px-3 border border-[#E4E6EB] rounded-lg text-[13px] outline-none font-[inherit]"
            />
          </div>
          <div>
            <div className="text-[12px] font-bold text-[#4B5563] mb-1">Local path</div>
            <input
              value={localPath}
              onChange={(e) => setLocalPath(e.target.value)}
              placeholder="/Users/you/projects/shop-tests"
              className="w-full box-border py-2.5 px-3 border border-[#E4E6EB] rounded-lg text-[13px] outline-none font-[inherit] font-mono"
            />
          </div>
        </div>
        <div className="flex justify-end gap-2 mt-5">
          <div
            onClick={onClose}
            className="text-[12.5px] font-semibold text-[#4B5563] py-2 px-4 border border-[#E4E6EB] rounded-lg cursor-pointer"
          >
            Cancel
          </div>
          <div
            onClick={() => void handleSubmit()}
            className="text-[12.5px] font-bold text-white py-2 px-4 rounded-lg cursor-pointer"
            style={{ background: busy || !name.trim() || !localPath.trim() ? '#C7C2FA' : ACCENT_COLOR }}
          >
            {busy ? 'Registering…' : 'Register & onboard'}
          </div>
        </div>
      </div>
    </div>
  );
}
