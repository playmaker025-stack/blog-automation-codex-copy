"use client";

import type { ReactNode } from "react";
import type { DraftReviewIssue, DraftReviewResult } from "@/lib/agents/draft-review";
import type { FinalDraftCheck, KeywordUsageReport, NaverLogicEvaluation, SeoEvaluation } from "@/lib/agents/types";
import { KeywordReportSections } from "@/components/pipeline/keyword-report-sections";
import {
  canApproveFinalDraft,
  collectFinalDraftCheckMessages,
  getFinalDraftCheckApprovalStatus,
} from "@/lib/agents/final-draft-check";

interface ResultData {
  title: string;
  wordCount: number;
  evalScore: number;
  pass: boolean;
  recommendations: string[];
  hashtags?: string[];
  imageFileNames?: string[];
  seoEvaluation?: SeoEvaluation;
  naverLogicEvaluation?: NaverLogicEvaluation;
  finalDraftCheck?: FinalDraftCheck;
}

interface DraftVersionReport {
  label: string;
  body: string;
  seoEvaluation: SeoEvaluation;
  keywordReport: KeywordUsageReport;
}

interface Props {
  contentTab: "draft" | "revision";
  approval: ReactNode;
  result: ResultData | null;
  reviewResult: DraftReviewResult | null;
  reviewIssues: DraftReviewIssue[];
  reviewApplied: boolean;
  publishUrl: string;
  publishingToIndex: boolean;
  publishNotice: { type: "ok" | "err"; msg: string } | null;
  draftVersionReports: DraftVersionReport[];
  onPublishUrlChange: (value: string) => void;
  onPublishToIndex: () => void;
}

function scoreTone(score: number): string {
  if (score >= 80) return "text-emerald-600";
  if (score >= 65) return "text-amber-600";
  return "text-red-500";
}

function looksBroken(value: string | null | undefined): boolean {
  if (!value) return false;
  return /[\uFFFD]|\u00C3|\u00C2|[\u00EC\u00ED\u00EF][\S\s]{0,3}[\u00EB\u00EA]|[\u0000-\u0008\u000B-\u000C\u000E-\u001F]/.test(value);
}

function cleanNotes(notes: string[]): string[] {
  return notes.filter((note) => note.trim() && !looksBroken(note));
}

function issueTone(severity: DraftReviewIssue["severity"]): string {
  if (severity === "blocker") return "border-red-200 bg-red-50 text-red-700";
  if (severity === "warning") return "border-amber-200 bg-amber-50 text-amber-700";
  return "border-zinc-200 bg-zinc-50 text-zinc-700";
}

function SimpleNotePanel({ title, notes }: { title: string; notes: string[] }) {
  if (notes.length === 0) return null;

  return (
    <div className="rounded-xl border border-zinc-200 bg-white p-4">
      <p className="mb-2 text-xs font-semibold text-zinc-600">{title}</p>
      <ul className="space-y-1">
        {notes.map((note, index) => (
          <li key={`${title}-${index}-${note}`} className="flex gap-2 text-sm text-zinc-700">
            <span className="text-zinc-400">-</span>
            <span>{note}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

function FinalDraftCheckPanel({ check }: { check: FinalDraftCheck }) {
  const status = getFinalDraftCheckApprovalStatus(check);
  const messages = collectFinalDraftCheckMessages(check);
  const tone =
    status === "blocked"
      ? "border-red-200 bg-red-50 text-red-800"
      : status === "warning"
        ? "border-amber-200 bg-amber-50 text-amber-800"
        : "border-emerald-200 bg-emerald-50 text-emerald-800";
  const statusText = status === "blocked" ? "승인 불가" : status === "warning" ? "승인 가능 · 주의 필요" : "승인 가능";
  const sections = [
    { title: "차단 사유", items: messages.blockingReasons, tone: "text-red-700" },
    { title: "주의 사항", items: messages.warnings, tone: "text-amber-700" },
    { title: "금지 표현", items: messages.matchedForbiddenPhrases, tone: "text-red-700" },
    { title: "질문문 / exact keyword", items: messages.keywordStuffingFindings, tone: "text-red-700" },
    { title: "다음 글로 미루기", items: messages.deferFindings, tone: "text-red-700" },
    { title: "계약서 반영 부족", items: messages.contractCoverageFindings, tone: "text-amber-700" },
    { title: "중복 감리", items: messages.overlapFindings, tone: "text-amber-700" },
  ].filter((section) => section.items.length > 0);

  return (
    <div className={`rounded-xl border p-4 ${tone}`}>
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-sm font-semibold">발행 전 최종 검사</p>
          <p className="mt-1 text-xs leading-5">
            {status === "blocked"
              ? "차단 사유가 있어 초안은 아직 승인 단계로 넘어갈 수 없습니다."
              : status === "warning"
                ? "차단 사유는 없지만, 아래 주의 항목을 확인한 뒤 승인하는 편이 좋습니다."
                : "최종 검사 기준에서 차단 요소가 없습니다."}
          </p>
        </div>
        <span className="rounded-full bg-white/70 px-2.5 py-1 text-xs font-semibold">{statusText}</span>
      </div>

      {sections.length > 0 ? (
        <div className="mt-4 space-y-3">
          {sections.map((section) => (
            <div key={section.title} className="rounded-lg border border-white/70 bg-white/70 px-3 py-3">
              <p className={`text-xs font-semibold ${section.tone}`}>{section.title}</p>
              <ul className="mt-2 space-y-1">
                {section.items.map((item, index) => (
                  <li key={`${section.title}-${index}-${item}`} className="flex gap-2 text-xs leading-5 text-zinc-700">
                    <span className="text-zinc-400">-</span>
                    <span>{item}</span>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      ) : null}
    </div>
  );
}

function SeoSummaryPanel({
  seoEvaluation,
  result,
}: {
  seoEvaluation: SeoEvaluation;
  result: ResultData | null;
}) {
  return (
    <div className="rounded-xl border border-zinc-200 bg-white p-4">
      <div className="flex items-start justify-between gap-4">
        <div>
          <p className="text-xs font-semibold text-zinc-600">SEO 평가 / 보고서</p>
          <p className="mt-1 text-sm font-semibold text-zinc-900">{result?.title ?? "현재 초안"}</p>
          <p className="mt-1 text-xs text-zinc-500">키워드, 구조, 제목-본문 연결성을 종합 점검합니다.</p>
        </div>
        <div className="text-right">
          <p className="text-[11px] font-semibold text-zinc-500">SEO 점수</p>
          <p className={`mt-1 text-2xl font-bold ${scoreTone(seoEvaluation.score)}`}>{seoEvaluation.score}</p>
        </div>
      </div>

      <SimpleNotePanel title="좋은 점" notes={cleanNotes(seoEvaluation.evidence)} />
      <SimpleNotePanel title="보강 권장 사항" notes={cleanNotes(seoEvaluation.improvements)} />
    </div>
  );
}

function NaverLogicPanel({ evaluation }: { evaluation: NaverLogicEvaluation }) {
  return (
    <div className="rounded-xl border border-zinc-200 bg-white p-4">
      <div className="flex items-start justify-between gap-4">
        <div>
          <p className="text-xs font-semibold text-zinc-600">네이버 로직 평가</p>
          <p className="mt-1 text-sm font-semibold text-zinc-900">{evaluation.label}</p>
          <p className="mt-1 text-xs leading-5 text-zinc-500">
            {looksBroken(evaluation.reason)
              ? "제목, 본문 구조, 검색의도 연결성을 기준으로 네이버 노출 적합도를 평가합니다."
              : evaluation.reason}
          </p>
        </div>
        <div className="text-right">
          <p className="text-[11px] font-semibold text-zinc-500">완성도</p>
          <p className={`mt-1 text-lg font-bold ${scoreTone(evaluation.completenessScore)}`}>{evaluation.completenessScore}</p>
        </div>
      </div>
      <SimpleNotePanel title="근거" notes={cleanNotes(evaluation.evidence)} />
      <SimpleNotePanel title="보강 권장 사항" notes={cleanNotes(evaluation.improvements)} />
    </div>
  );
}

function HashAssetPanel({
  hashtags,
  imageFileNames,
}: {
  hashtags?: string[];
  imageFileNames?: string[];
}) {
  if ((!hashtags || hashtags.length === 0) && (!imageFileNames || imageFileNames.length === 0)) return null;

  return (
    <div className="rounded-xl border border-zinc-200 bg-white p-4">
      <p className="text-xs font-semibold text-zinc-600">해시태그 / 사진 파일명</p>

      {hashtags && hashtags.length > 0 ? (
        <div className="mt-3">
          <p className="text-[11px] font-semibold text-zinc-500">추천 해시태그</p>
          <div className="mt-2 flex flex-wrap gap-2">
            {hashtags.map((tag) => (
              <span key={tag} className="rounded-full bg-zinc-100 px-2.5 py-1 text-xs text-zinc-700">
                {tag}
              </span>
            ))}
          </div>
        </div>
      ) : null}

      {imageFileNames && imageFileNames.length > 0 ? (
        <div className="mt-4">
          <p className="text-[11px] font-semibold text-zinc-500">추천 사진 파일명</p>
          <ul className="mt-2 space-y-1">
            {imageFileNames.map((name) => (
              <li key={name} className="rounded-md bg-zinc-50 px-2.5 py-2 text-xs text-zinc-700">
                {name}
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </div>
  );
}

export function PipelineReportPanel({
  contentTab,
  approval,
  result,
  reviewResult,
  reviewIssues,
  reviewApplied,
  publishUrl,
  publishingToIndex,
  publishNotice,
  draftVersionReports,
  onPublishUrlChange,
  onPublishToIndex,
}: Props) {
  const activeSeoEvaluation =
    contentTab === "revision" ? reviewResult?.seoEvaluation ?? result?.seoEvaluation ?? null : result?.seoEvaluation ?? null;
  const activeKeywordReport =
    contentTab === "revision" ? reviewResult?.keywordReport ?? result?.seoEvaluation?.keywordReport ?? null : result?.seoEvaluation?.keywordReport ?? null;
  const visibleReviewIssues = reviewIssues.filter((issue) => !looksBroken(issue.message));

  return (
    <aside className="space-y-4">
      {approval}

      {!result && !reviewResult ? (
        <div className="rounded-xl border border-zinc-200 bg-white p-6">
          <p className="text-sm font-semibold text-zinc-900">평가 / 보고서</p>
          <p className="mt-3 text-sm leading-7 text-zinc-500">
            초안 생성과 평가가 끝나면 이곳에 최종 검사, 키워드 분석, SEO 보고서, 해시태그와 사진 파일명이 정리됩니다.
          </p>
        </div>
      ) : null}

      {result?.finalDraftCheck ? <FinalDraftCheckPanel check={result.finalDraftCheck} /> : null}

      {contentTab === "draft" && draftVersionReports.length > 0 ? (
        <div className="space-y-3">
          {draftVersionReports.map((versionReport) => (
            <KeywordReportSections
              key={`keyword-${versionReport.label}`}
              report={versionReport.keywordReport}
              title={versionReport.label}
              compact
            />
          ))}
        </div>
      ) : activeKeywordReport ? (
        <KeywordReportSections report={activeKeywordReport} title="키워드 분석" />
      ) : null}

      {activeSeoEvaluation ? <SeoSummaryPanel seoEvaluation={activeSeoEvaluation} result={result} /> : null}

      {result?.naverLogicEvaluation ? <NaverLogicPanel evaluation={result.naverLogicEvaluation} /> : null}

      {visibleReviewIssues.length > 0 ? (
        <div className="rounded-xl border border-zinc-200 bg-white p-4">
          <p className="mb-3 text-xs font-semibold text-zinc-600">수정본 검토 이슈</p>
          <div className="space-y-2">
            {visibleReviewIssues.map((issue) => (
              <div key={`${issue.severity}-${issue.message}`} className={`rounded-lg border px-3 py-2 text-sm ${issueTone(issue.severity)}`}>
                {issue.message}
              </div>
            ))}
          </div>
        </div>
      ) : null}

      <HashAssetPanel hashtags={result?.hashtags} imageFileNames={result?.imageFileNames} />

      {contentTab === "revision" && result ? (
        <div className="space-y-4 rounded-xl border border-zinc-200 bg-white p-4">
          <div>
            <p className="text-xs font-semibold text-zinc-600">인덱스 템플릿 / 발행 반영</p>
            <p className="mt-1 text-[11px] leading-5 text-zinc-500">
              수정본을 실제로 발행한 뒤 URL을 입력하면 발행 인덱스와 학습 데이터에 함께 반영합니다.
            </p>
          </div>

          <input
            value={publishUrl}
            onChange={(event) => onPublishUrlChange(event.target.value)}
            placeholder="https://blog.naver.com/..."
            className="w-full rounded-lg border border-zinc-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500/20"
          />

          <button
            type="button"
            onClick={onPublishToIndex}
            disabled={publishingToIndex || !publishUrl.trim() || !canApproveFinalDraft(result.finalDraftCheck)}
            className="w-full rounded-lg bg-emerald-600 px-4 py-2 text-sm font-semibold text-white disabled:opacity-40"
          >
            {publishingToIndex ? "발행 인덱스 반영 중" : "발행 인덱스에 반영"}
          </button>

          {result.finalDraftCheck && !canApproveFinalDraft(result.finalDraftCheck) ? (
            <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-3 text-sm text-red-700">
              발행 전 최종 검사에 차단 사유가 있어 인덱스 반영을 막고 있습니다. 먼저 차단 사유를 수정해 주세요.
            </div>
          ) : null}

          {publishNotice ? (
            <div
              className={`rounded-lg px-3 py-3 text-sm ${
                publishNotice.type === "ok"
                  ? "border border-emerald-200 bg-emerald-50 text-emerald-700"
                  : "border border-red-200 bg-red-50 text-red-700"
              }`}
            >
              {publishNotice.msg}
            </div>
          ) : null}

          {reviewApplied ? (
            <div className="rounded-lg border border-blue-200 bg-blue-50 px-3 py-3 text-sm text-blue-700">
              수정본을 실제 본문에 반영했습니다. 발행 후 URL을 입력하면 인덱스와 학습 데이터에 함께 반영됩니다.
            </div>
          ) : null}
        </div>
      ) : null}
    </aside>
  );
}
