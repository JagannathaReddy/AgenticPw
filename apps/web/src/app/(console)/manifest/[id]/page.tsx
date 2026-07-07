"use client";

import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { useConsoleStore } from "@/store/useConsoleStore";
import { buildRow } from "@/lib/selectors";
import { cliEquivalentForManifest } from "@/lib/manifestDetail";
import { ACCENT_COLOR } from "@/lib/meta";
import type { FeedbackDir, ManifestRow } from "@/lib/types";
import FeedbackNoteModal from "@/components/FeedbackNoteModal";
import TimelineTab from "@/components/tabs/TimelineTab";
import StewardReportTab from "@/components/tabs/StewardReportTab";
import DiffTab from "@/components/tabs/DiffTab";
import ExplorerTab from "@/components/tabs/ExplorerTab";
import GeneratorTab from "@/components/tabs/GeneratorTab";
import JudgeTab from "@/components/tabs/JudgeTab";
import ArtifactsTab from "@/components/tabs/ArtifactsTab";
import LlmCallsTab from "@/components/tabs/LlmCallsTab";
import FeedbackTab from "@/components/tabs/FeedbackTab";

const TABS_ALL = [
  { key: "timeline", label: "Timeline" },
  { key: "steward", label: "Health report" },
  { key: "diff", label: "Diff" },
  { key: "explorer", label: "Explorer" },
  { key: "generator", label: "Generator" },
  { key: "judge", label: "Judge" },
  { key: "artifacts", label: "Artifacts" },
  { key: "llm", label: "LLM Calls" },
  { key: "feedback", label: "Feedback" },
] as const;

type TabKey = (typeof TABS_ALL)[number]["key"];

export default function ManifestDetailPage() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const manifests = useConsoleStore((s) => s.manifests);

  const raw = manifests.find((m) => m.id === params.id);

  if (!raw) {
    return (
      <div className="max-w-[1180px]">
        <div
          onClick={() => router.push("/manifests")}
          className="inline-flex items-center gap-1.5 text-[12.5px] font-semibold text-[#6B7280] cursor-pointer mb-3.5"
        >
          <span>←</span>
          <span>All manifests</span>
        </div>
        <div className="bg-white border border-[#E4E6EB] rounded-xl p-10 text-center text-[#9CA3AF]">
          Manifest not found.
        </div>
      </div>
    );
  }

  return <ManifestDetailBody key={raw.id} manifest={buildRow(raw)} />;
}

function ManifestDetailBody({ manifest }: { manifest: ManifestRow }) {
  const router = useRouter();
  const applyManifest = useConsoleStore((s) => s.applyManifest);
  const rejectManifest = useConsoleStore((s) => s.rejectManifest);
  const giveFeedback = useConsoleStore((s) => s.giveFeedback);
  const showToast = useConsoleStore((s) => s.showToast);
  const [llmCount, setLlmCount] = useState(0);
  const [activeTab, setActiveTab] = useState<TabKey>(manifest.raw.flow === "steward" ? "steward" : "timeline");
  const [feedbackModal, setFeedbackModal] = useState<{ open: boolean; dir: FeedbackDir }>({
    open: false,
    dir: null,
  });
  const [rejectModal, setRejectModal] = useState(false);

  useEffect(() => {
    void import("@/lib/api").then(({ apiFetch }) =>
      apiFetch<Array<unknown>>(`/v1/tests/${manifest.id}/llm-calls`)
        .then((rows) => setLlmCount(rows.length))
        .catch(() => setLlmCount(0)),
    );
  }, [manifest.id]);

  const flow = manifest.raw.flow;
  const showDiffTab = ["heal", "improve", "batch"].includes(flow);
  const showExplorerTab = ["add", "heal"].includes(flow);
  const showStewardTab = flow === "steward";
  const tabs = TABS_ALL.filter((t) =>
    t.key === "steward"
      ? showStewardTab
      : t.key === "diff"
      ? showDiffTab
      : t.key === "explorer"
      ? showExplorerTab
      : true,
  );

  const showApplyActions = manifest.raw.status === "accepted" && manifest.raw.hasPatch;
  const showFeedbackActions =
    manifest.raw.status === "accepted" || manifest.raw.status === "applied";

  const copyLink = () => {
    if (typeof window !== "undefined") {
      navigator.clipboard?.writeText(window.location.origin + "/manifest/" + manifest.id);
    }
    showToast("Link copied to clipboard.", 2000);
  };
  const copyCli = () => {
    navigator.clipboard?.writeText(cliEquivalentForManifest(manifest.raw));
    showToast("CLI equivalent copied.", 2000);
  };

  const submitFeedback = async (dir: FeedbackDir, note: string) => {
    if (!dir) return;
    await giveFeedback(manifest.id, dir, note || undefined);
    setFeedbackModal({ open: false, dir: null });
  };

  return (
    <div className="max-w-[1180px]">
      <div
        onClick={() => router.push("/manifests")}
        className="inline-flex items-center gap-1.5 text-[12.5px] font-semibold text-[#6B7280] cursor-pointer mb-3.5"
      >
        <span>←</span>
        <span>All manifests</span>
      </div>

      <div className="bg-white border border-[#E4E6EB] rounded-xl py-5 px-5.5 mb-4">
        <div className="flex items-center gap-2.5 flex-wrap">
          <span className="font-mono text-[15px] font-bold">{manifest.shortId}</span>
          <span
            className="text-[11px] font-bold py-[3px] px-[9px] rounded-md"
            style={{ color: manifest.flowFg, background: manifest.flowBg }}
          >
            {manifest.flowLabel}
          </span>
          <span
            className="text-[11px] font-bold py-[3px] px-[9px] rounded-full"
            style={{ color: manifest.statusFg, background: manifest.statusBg }}
          >
            {manifest.statusLabel}
          </span>
          <span className="text-[12px] text-[#9CA3AF]">{manifest.categoryLabel}</span>
          <div className="flex-1" />
          <div
            onClick={copyLink}
            className="text-[12px] font-semibold text-[#6B7280] cursor-pointer py-1.5 px-2.5 border border-[#E4E6EB] rounded-lg"
          >
            Copy link
          </div>
          <div
            onClick={copyCli}
            className="text-[12px] font-semibold text-[#6B7280] cursor-pointer py-1.5 px-2.5 border border-[#E4E6EB] rounded-lg"
          >
            Copy CLI equivalent
          </div>
        </div>
        <div className="text-[13.5px] text-[#4B5563] mt-2 font-mono">{manifest.target}</div>
        {manifest.raw.failureReason && (
          <div className="mt-3 py-2.5 px-3 bg-[#FEF2F2] rounded-lg text-[12.5px] text-[#DC2626] whitespace-pre-wrap">
            {manifest.raw.failureReason}
          </div>
        )}
        {manifest.raw.alreadyPassing && (
          <div className="mt-3 py-2.5 px-3 bg-[#DCFCE7] rounded-lg text-[12.5px] text-[#15803D]">
            Test was already passing when the heal ran — no patch to apply.
          </div>
        )}
        <div className="flex gap-5.5 mt-3.5 items-center flex-wrap">
          <div>
            <div className="text-[11px] text-[#9CA3AF] font-semibold">REPO</div>
            <div className="text-[13px] font-semibold">{manifest.repo}</div>
          </div>
          <div>
            <div className="text-[11px] text-[#9CA3AF] font-semibold">COST</div>
            <div className="text-[13px] font-semibold">{manifest.costLabel}</div>
          </div>
          <div>
            <div className="text-[11px] text-[#9CA3AF] font-semibold">DURATION</div>
            <div className="text-[13px] font-semibold">{manifest.durationLabel}</div>
          </div>
          <div>
            <div className="text-[11px] text-[#9CA3AF] font-semibold">LLM CALLS</div>
            <div className="text-[13px] font-semibold">{llmCount}</div>
          </div>
          <div className="flex-1" />
          {showApplyActions && (
            <div className="flex gap-2">
              <div
                onClick={() => setRejectModal(true)}
                className="text-[12.5px] font-bold text-[#DC2626] cursor-pointer py-2 px-3.5 border border-[#FECACA] bg-[#FEF2F2] rounded-lg"
              >
                Reject
              </div>
              <div
                onClick={() => void applyManifest(manifest.id)}
                className="text-[12.5px] font-bold text-white cursor-pointer py-2 px-3.5 rounded-lg"
                style={{ background: ACCENT_COLOR }}
              >
                Apply
              </div>
            </div>
          )}
          {showFeedbackActions && (
            <div className="flex gap-1.5 items-center">
              <div
                onClick={() => setFeedbackModal({ open: true, dir: "up" })}
                className="text-[16px] cursor-pointer py-1.5 px-2.5 rounded-lg"
                style={{ background: manifest.raw.feedback === "up" ? "#DCFCE7" : "#F5F6F8" }}
              >
                👍
              </div>
              <div
                onClick={() => setFeedbackModal({ open: true, dir: "down" })}
                className="text-[16px] cursor-pointer py-1.5 px-2.5 rounded-lg"
                style={{ background: manifest.raw.feedback === "down" ? "#FEE2E2" : "#F5F6F8" }}
              >
                👎
              </div>
            </div>
          )}
        </div>
      </div>

      <div className="flex gap-0.5 border-b border-[#E4E6EB] mb-4.5 flex-wrap">
        {tabs.map((t) => {
          const active = activeTab === t.key;
          return (
            <div
              key={t.key}
              onClick={() => setActiveTab(t.key)}
              className="py-2.5 px-3.5 text-[13px] cursor-pointer"
              style={{
                fontWeight: active ? 700 : 600,
                color: active ? "#14161B" : "#9CA3AF",
                borderBottom: active ? `2px solid ${ACCENT_COLOR}` : "2px solid transparent",
              }}
            >
              {t.label}
            </div>
          );
        })}
      </div>

      {activeTab === "timeline" && <TimelineTab manifest={manifest} />}
      {activeTab === "steward" && showStewardTab && <StewardReportTab manifest={manifest} />}
      {activeTab === "diff" && showDiffTab && <DiffTab manifest={manifest} />}
      {activeTab === "explorer" && showExplorerTab && <ExplorerTab manifest={manifest} />}
      {activeTab === "generator" && <GeneratorTab manifest={manifest} />}
      {activeTab === "judge" && <JudgeTab manifest={manifest} />}
      {activeTab === "artifacts" && <ArtifactsTab manifestId={manifest.id} />}
      {activeTab === "llm" && <LlmCallsTab manifestId={manifest.id} />}
      {activeTab === "feedback" && <FeedbackTab manifest={manifest} />}

      <FeedbackNoteModal
        open={feedbackModal.open}
        direction={feedbackModal.dir}
        initialNote={manifest.raw.feedbackNote}
        onClose={() => setFeedbackModal({ open: false, dir: null })}
        onSubmit={(note) => void submitFeedback(feedbackModal.dir, note)}
      />

      <FeedbackNoteModal
        open={rejectModal}
        direction="down"
        title="Why reject this patch?"
        onClose={() => setRejectModal(false)}
        onSubmit={(note) => {
          void rejectManifest(manifest.id, note);
          setRejectModal(false);
        }}
      />
    </div>
  );
}
