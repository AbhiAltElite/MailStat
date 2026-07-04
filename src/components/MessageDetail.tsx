import { useEffect, useState } from "react";
import { api, type MessageBody, type MessageDetail as Detail, type MessageRow } from "../lib/api";
import { CATEGORY_LABELS, colorFor } from "../lib/colors";
import { formatBytes, formatDate } from "../lib/format";

interface Props {
  messageId: number;
  onClose: () => void;
  onNavigate: (id: number) => void;
  onAction: (action: "trash" | "archive" | "delete", detail: Detail) => void;
  onShowSender: (email: string, name: string) => void;
  onUnsubscribe: (raw: string) => void;
}

export default function MessageDetail({
  messageId,
  onClose,
  onNavigate,
  onAction,
  onShowSender,
  onUnsubscribe,
}: Props) {
  const [detail, setDetail] = useState<Detail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [body, setBody] = useState<MessageBody | null>(null);
  const [bodyLoading, setBodyLoading] = useState(false);
  const [bodyError, setBodyError] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    setDetail(null);
    setError(null);
    setBody(null);
    setBodyLoading(false);
    setBodyError(null);
    api
      .messageDetail(messageId)
      .then((d) => live && setDetail(d))
      .catch((e) => live && setError(String(e)));
    return () => {
      live = false;
    };
  }, [messageId]);

  const loadBody = () => {
    setBodyLoading(true);
    setBodyError(null);
    api
      .messageBody(messageId)
      .then(setBody)
      .catch((e) => setBodyError(String(e)))
      .finally(() => setBodyLoading(false));
  };

  return (
    <div className="fixed inset-0 z-40 flex justify-end bg-black/40" onClick={onClose}>
      <section
        onClick={(e) => e.stopPropagation()}
        className="flex h-full w-105 flex-col border-l border-line bg-surface shadow-2xl"
        aria-label="Message details"
      >
        <header className="flex items-start justify-between gap-3 border-b border-line px-4 py-3">
          <h2 className="min-w-0 text-sm leading-snug font-semibold text-ink">
            {detail ? detail.subject || "(no subject)" : "Message"}
          </h2>
          <button
            onClick={onClose}
            className="shrink-0 rounded-md px-2 py-1 text-xs text-muted hover:bg-raised hover:text-ink"
          >
            Close
          </button>
        </header>

        {error && <p className="p-4 text-xs text-danger">{error}</p>}

        {!detail && !error && (
          <div className="flex flex-col gap-2 p-4" aria-busy="true">
            {[...Array(6)].map((_, i) => (
              <div key={i} className="h-4 animate-pulse rounded-md bg-raised" />
            ))}
          </div>
        )}

        {detail && (
          <div className="min-h-0 flex-1 overflow-y-auto">
            <dl className="grid grid-cols-[72px_1fr] gap-x-3 gap-y-2 px-4 py-3 text-xs">
              <dt className="text-faint">From</dt>
              <dd className="min-w-0">
                <button
                  onClick={() => onShowSender(detail.from_email, detail.from_name)}
                  className="max-w-full truncate text-left text-accent hover:underline"
                  title="Show this sender in the treemap"
                >
                  {detail.from_name || detail.from_email}
                </button>
                <span className="block truncate text-faint">{detail.from_email}</span>
              </dd>
              <dt className="text-faint">Date</dt>
              <dd className="text-ink">{formatDate(detail.date)}</dd>
              <dt className="text-faint">Folder</dt>
              <dd className="text-ink">{detail.folder}</dd>
              <dt className="text-faint">Size</dt>
              <dd className="text-ink">{formatBytes(detail.size)}</dd>
              <dt className="text-faint">Type</dt>
              <dd className="flex items-center gap-1.5 text-ink">
                <span
                  className="inline-block h-2.5 w-2.5 rounded-sm"
                  style={{ background: colorFor(detail.cat) }}
                />
                {CATEGORY_LABELS[detail.cat] ?? detail.cat}
              </dd>
            </dl>

            <div className="flex gap-2 border-y border-line px-4 py-3">
              <button
                onClick={() => onAction("archive", detail)}
                className="rounded-md border border-line bg-surface px-3 py-1.5 text-xs font-medium text-ink hover:bg-raised"
              >
                Archive
              </button>
              <button
                onClick={() => onAction("trash", detail)}
                className="rounded-md border border-line bg-surface px-3 py-1.5 text-xs font-medium text-ink hover:bg-raised"
              >
                Move to Trash
              </button>
              <button
                onClick={() => onAction("delete", detail)}
                className="rounded-md bg-danger-surface px-3 py-1.5 text-xs font-medium text-danger hover:opacity-85"
              >
                Delete
              </button>
              {detail.list_unsubscribe && (
                <button
                  onClick={() => onUnsubscribe(detail.list_unsubscribe!)}
                  className="ml-auto rounded-md border border-line px-3 py-1.5 text-xs text-muted hover:bg-raised hover:text-ink"
                >
                  Unsubscribe
                </button>
              )}
            </div>

            <Section title="Content">
              {!body && !bodyLoading && (
                <div className="px-4 py-2">
                  <button
                    onClick={loadBody}
                    className="rounded-md border border-line bg-surface px-3 py-1.5 text-xs font-medium text-ink hover:bg-raised"
                  >
                    Load message content
                  </button>
                  <p className="mt-1.5 text-[11px] text-faint">
                    Fetched live from the server for this message only. Not cached, and remote
                    images are blocked.
                  </p>
                  {bodyError && <p className="mt-1.5 text-xs text-danger">{bodyError}</p>}
                </div>
              )}
              {bodyLoading && (
                <div className="flex flex-col gap-2 px-4 py-2" aria-busy="true">
                  {[...Array(4)].map((_, i) => (
                    <div key={i} className="h-3 animate-pulse rounded-md bg-raised" />
                  ))}
                </div>
              )}
              {body && (
                <div className="px-4 py-2">
                  {body.truncated && (
                    <p className="mb-1.5 text-[11px] text-faint">
                      This message was long, so the content shown below is truncated.
                    </p>
                  )}
                  {body.content_type === "none" && (
                    <p className="text-xs text-faint">
                      No readable content was found for this message.
                    </p>
                  )}
                  {body.content_type === "text" && (
                    <pre className="max-h-90 overflow-y-auto rounded-md border border-line bg-canvas p-3 text-xs whitespace-pre-wrap text-ink">
                      {body.content}
                    </pre>
                  )}
                  {body.content_type === "html" && (
                    <iframe
                      title="Message content"
                      sandbox=""
                      srcDoc={body.content}
                      className="h-90 w-full rounded-md border border-line bg-white"
                    />
                  )}
                  <button
                    onClick={loadBody}
                    className="mt-2 text-[11px] text-muted hover:text-ink hover:underline"
                  >
                    Reload content
                  </button>
                </div>
              )}
            </Section>

            {detail.attachments.length > 0 && (
              <Section title={`Attachments (${detail.attachments.length})`}>
                {detail.attachments.map((a, i) => (
                  <div key={i} className="flex items-center gap-2 px-4 py-1.5 text-xs">
                    <span
                      className="h-2.5 w-2.5 shrink-0 rounded-sm"
                      style={{ background: colorFor(a.ext || "other") }}
                    />
                    <span className="min-w-0 flex-1 truncate text-ink" title={a.filename}>
                      {a.filename || a.mime}
                    </span>
                    <span className="shrink-0 tabular-nums text-muted">{formatBytes(a.size)}</span>
                  </div>
                ))}
              </Section>
            )}

            {detail.thread.length > 1 && (
              <Section title={`Conversation (${detail.thread.length})`}>
                {detail.thread.map((m) => (
                  <RelatedRow key={m.id} m={m} current={m.id === detail.id} onNavigate={onNavigate} />
                ))}
              </Section>
            )}

            {detail.from_sender.length > 0 && (
              <Section title={`More from ${detail.from_name || detail.from_email}`}>
                {detail.from_sender.map((m) => (
                  <RelatedRow key={m.id} m={m} current={false} onNavigate={onNavigate} />
                ))}
              </Section>
            )}
          </div>
        )}
      </section>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="border-b border-line py-2">
      <h3 className="px-4 pt-1 pb-1.5 text-[11px] font-semibold tracking-wider text-faint uppercase">
        {title}
      </h3>
      {children}
    </section>
  );
}

function RelatedRow({
  m,
  current,
  onNavigate,
}: {
  m: MessageRow;
  current: boolean;
  onNavigate: (id: number) => void;
}) {
  return (
    <button
      onClick={() => !current && onNavigate(m.id)}
      disabled={current}
      className={`flex w-full items-center gap-2 px-4 py-1.5 text-left text-xs ${
        current ? "bg-raised" : "hover:bg-raised"
      }`}
    >
      <span className="h-2.5 w-2.5 shrink-0 rounded-sm" style={{ background: colorFor(m.cat) }} />
      <span className="min-w-0 flex-1">
        <span className="block truncate text-ink">
          {m.subject || "(no subject)"}
          {current && <span className="ml-1.5 text-faint">(this message)</span>}
        </span>
        <span className="block truncate text-faint">
          {m.from_name || m.from_email} · {m.folder} · {formatDate(m.date)}
        </span>
      </span>
      <span className="shrink-0 tabular-nums text-muted">{formatBytes(m.size)}</span>
    </button>
  );
}
