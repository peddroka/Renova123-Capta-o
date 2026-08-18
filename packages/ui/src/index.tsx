import {
  useEffect,
  useId,
  useRef,
  type ButtonHTMLAttributes,
  type ChangeEvent,
  type HTMLAttributes,
  type ReactNode,
} from "react";

type Tone = "neutral" | "positive" | "warning" | "danger" | "info";

export function AppShell({ sidebar, children, className = "" }: { sidebar: ReactNode; children: ReactNode; className?: string }) {
  return <div className={`ui-app-shell ${className}`}>{sidebar}{children}</div>;
}

export function Sidebar({ children, open = false, onClose, ariaLabel = "Navegação principal", className = "" }: { children: ReactNode; open?: boolean; onClose?: () => void; ariaLabel?: string; className?: string }) {
  useDismiss(open, onClose);
  return <aside className={`ui-sidebar ${open ? "is-open" : ""} ${className}`} aria-label={ariaLabel}>{children}</aside>;
}

export function SidebarItem({ icon, label, active = false, renderLink, badge }: { icon: ReactNode; label: string; active?: boolean; badge?: string | number; renderLink: (content: ReactNode, className: string) => ReactNode }) {
  const content = <><span className="ui-sidebar-item__icon" aria-hidden>{icon}</span><span className="ui-sidebar-item__label">{label}</span>{badge !== undefined ? <span className="ui-sidebar-item__badge">{badge}</span> : null}<span className="ui-sidebar-item__tooltip" role="tooltip">{label}</span></>;
  return <>{renderLink(content, `ui-sidebar-item ${active ? "active" : ""}`)}</>;
}

export function PageHeader({ eyebrow, title, description, icon, actions }: { eyebrow?: string; title: string; description?: string; icon?: ReactNode; actions?: ReactNode }) {
  return <header className="ui-page-header"><div>{icon ? <span className="ui-page-header__icon">{icon}</span> : null}<div>{eyebrow ? <p>{eyebrow}</p> : null}<h1>{title}</h1>{description ? <span>{description}</span> : null}</div></div>{actions ? <div className="ui-page-header__actions">{actions}</div> : null}</header>;
}

export function HeroHeader(props: Parameters<typeof PageHeader>[0]) { return <section className="ui-hero-header"><span className="ui-hero-header__orb" aria-hidden /><span className="ui-hero-header__grid" aria-hidden /><PageHeader {...props} /></section>; }

export function MetricCard({ label, value, note, icon, trend, tone = "neutral", loading = false }: { label: string; value: ReactNode; note?: string; icon?: ReactNode; trend?: string; tone?: Tone; loading?: boolean }) {
  return <article className={`ui-metric-card ${tone}`}>{icon ? <span className="ui-metric-card__icon">{icon}</span> : null}<div><p>{label}</p>{loading ? <LoadingSkeleton lines={1} compact /> : <strong>{value}</strong>}{note ? <small>{note}</small> : null}</div>{trend ? <b>{trend}</b> : null}</article>;
}

export function DataCard({ title, eyebrow, description, action, children, className = "" }: { title?: string; eyebrow?: string; description?: string; action?: ReactNode; children: ReactNode; className?: string }) {
  return <section className={`ui-data-card ${className}`}>{title || eyebrow || action ? <header><div>{eyebrow ? <p>{eyebrow}</p> : null}{title ? <h2>{title}</h2> : null}{description ? <span>{description}</span> : null}</div>{action}</header> : null}{children}</section>;
}

export type DataColumn<T> = { key: string; label: string; render: (row: T) => ReactNode; mobileLabel?: string };
export function DataTable<T>({ rows, columns, rowKey, empty }: { rows: T[]; columns: DataColumn<T>[]; rowKey: (row: T, index: number) => string; empty?: ReactNode }) {
  if (!rows.length) return <>{empty ?? <EmptyState title="Nenhum registro" description="Não há dados para os filtros atuais." />}</>;
  return <div className="ui-data-table-wrap"><table className="ui-data-table"><thead><tr>{columns.map((column) => <th key={column.key}>{column.label}</th>)}</tr></thead><tbody>{rows.map((row, index) => <tr key={rowKey(row, index)}>{columns.map((column) => <td key={column.key} data-label={column.mobileLabel ?? column.label}>{column.render(row)}</td>)}</tr>)}</tbody></table><div className="ui-data-card-list">{rows.map((row, index) => <article key={rowKey(row, index)}>{columns.map((column) => <div key={column.key}><span>{column.mobileLabel ?? column.label}</span><strong>{column.render(row)}</strong></div>)}</article>)}</div></div>;
}

export function FilterBar({ children, actions }: { children: ReactNode; actions?: ReactNode }) { return <div className="ui-filter-bar"><div>{children}</div>{actions ? <div className="ui-filter-bar__actions">{actions}</div> : null}</div>; }

export function SearchInput({ value, onChange, placeholder = "Pesquisar...", icon, id = "page-search" }: { value: string; onChange: (value: string) => void; placeholder?: string; icon?: ReactNode; id?: string }) {
  return <label className="ui-search-input">{icon ? <span aria-hidden>{icon}</span> : null}<span className="sr-only">Pesquisar</span><input id={id} type="search" value={value} placeholder={placeholder} onChange={(event) => onChange(event.target.value)} /></label>;
}

export function StatusBadge({ children, tone = "neutral", dot = false }: { children: ReactNode; tone?: Tone; dot?: boolean }) { return <span className={`ui-status-badge ${tone}`}>{dot ? <i /> : null}{children}</span>; }

export function EmptyState({ title, description, action, icon }: { title: string; description: string; action?: ReactNode; icon?: ReactNode }) { return <div className="ui-empty-state">{icon ? <span>{icon}</span> : <span aria-hidden>R123</span>}<h3>{title}</h3><p>{description}</p>{action}</div>; }

export function ErrorState({ title = "Não foi possível carregar", description, retry }: { title?: string; description: string; retry?: () => void }) { return <div className="ui-error-state" role="alert"><span aria-hidden>!</span><div><h3>{title}</h3><p>{description}</p>{retry ? <Button onClick={retry}>Tentar novamente</Button> : null}</div></div>; }

export function LoadingSkeleton({ lines = 5, compact = false }: { lines?: number; compact?: boolean }) { return <div className={`ui-loading-skeleton ${compact ? "compact" : ""}`} aria-label="Carregando" aria-busy="true">{Array.from({ length: lines }, (_, index) => <span key={index} />)}</div>; }

export function ConfirmDialog({ open, title, description, confirmLabel = "Confirmar", cancelLabel = "Cancelar", danger = false, onConfirm, onClose }: { open: boolean; title: string; description: string; confirmLabel?: string; cancelLabel?: string; danger?: boolean; onConfirm: () => void; onClose: () => void }) {
  return <Modal open={open} title={title} description={description} onClose={onClose} size="small"><footer className="ui-dialog-actions"><Button variant="secondary" onClick={onClose}>{cancelLabel}</Button><Button variant={danger ? "danger" : "primary"} onClick={() => { onConfirm(); onClose(); }}>{confirmLabel}</Button></footer></Modal>;
}

export function Drawer({ open, title, children, onClose, side = "right" }: { open: boolean; title: string; children: ReactNode; onClose: () => void; side?: "left" | "right" }) {
  useDismiss(open, onClose);
  if (!open) return null;
  return <div className="ui-overlay" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}><aside className={`ui-drawer ${side}`} role="dialog" aria-modal="true" aria-label={title}><header><h2>{title}</h2><button type="button" aria-label="Fechar" onClick={onClose}>×</button></header><div className="ui-drawer__body">{children}</div></aside></div>;
}

export function Modal({ open, title, description, children, onClose, size = "medium" }: { open: boolean; title: string; description?: string; children: ReactNode; onClose: () => void; size?: "small" | "medium" | "large" }) {
  useDismiss(open, onClose);
  if (!open) return null;
  return <div className="ui-overlay" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}><section className={`ui-modal ${size}`} role="dialog" aria-modal="true" aria-labelledby="ui-modal-title"><header><div><h2 id="ui-modal-title">{title}</h2>{description ? <p>{description}</p> : null}</div><button type="button" aria-label="Fechar" onClick={onClose}>×</button></header><div className="ui-modal__body">{children}</div></section></div>;
}

export function Toast({ message, tone = "positive", onClose }: { message: string; tone?: Tone; onClose?: () => void }) { return <div className={`ui-toast ${tone}`} role={tone === "danger" ? "alert" : "status"}><i /><span>{message}</span>{onClose ? <button aria-label="Fechar aviso" onClick={onClose}>×</button> : null}</div>; }
export function ToastViewport({ children }: { children: ReactNode }) { return <div className="ui-toast-viewport">{children}</div>; }

export function FileUploader({ accept, maxSizeMb = 25, file, onChange, label = "Arraste o arquivo ou clique para selecionar", description = "CSV, XLSX ou arquivo compatível", icon }: { accept?: string; maxSizeMb?: number; file?: File | null; onChange: (file: File | null) => void; label?: string; description?: string; icon?: ReactNode }) {
  const inputId = useId();
  function select(event: ChangeEvent<HTMLInputElement>) { const next = event.target.files?.[0] ?? null; if (next && next.size > maxSizeMb * 1024 * 1024) { event.target.value = ""; onChange(null); return; } onChange(next); }
  return <label htmlFor={inputId} className="ui-file-uploader" onDragOver={(event) => event.preventDefault()} onDrop={(event) => { event.preventDefault(); const next = event.dataTransfer.files?.[0] ?? null; if (!next || next.size > maxSizeMb * 1024 * 1024) return onChange(null); onChange(next); }}>{icon ? <span>{icon}</span> : null}<strong>{file?.name ?? label}</strong><p>{file ? `${formatBytes(file.size)} • pronto para validar` : description}</p><em>Selecionar arquivo</em><input id={inputId} type="file" accept={accept} onChange={select} /></label>;
}

export function PhonePreview({ phone, name, company, status }: { phone: string; name?: string; company?: string; status?: ReactNode }) { return <article className="ui-phone-preview"><span>{initials(name || company || phone)}</span><div><strong>{name || "Contato sem nome"}</strong><small>{company || phone}</small></div>{status}</article>; }

export function ThemeToggle({ theme, onToggle, lightIcon, darkIcon }: { theme: "light" | "dark"; onToggle: () => void; lightIcon?: ReactNode; darkIcon?: ReactNode }) { return <button className="ui-theme-toggle" type="button" aria-label={theme === "dark" ? "Ativar tema claro" : "Ativar tema escuro"} aria-pressed={theme === "dark"} onClick={onToggle}>{theme === "dark" ? lightIcon ?? "☀" : darkIcon ?? "◐"}<span>{theme === "dark" ? "Tema claro" : "Tema escuro"}</span></button>; }

export function SystemStatusIndicator({ label, status, tone = "positive", detail }: { label: string; status: string; tone?: Tone; detail?: string }) { return <div className="ui-system-status"><i className={tone} /><div><strong>{label}</strong>{detail ? <small>{detail}</small> : null}</div><span>{status}</span></div>; }

export function Button({ className = "", variant = "primary", ...props }: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: "primary" | "secondary" | "danger" | "ghost" }) { return <button className={`ui-button ${variant} ${className}`} {...props} />; }
export function Card({ className = "", ...props }: HTMLAttributes<HTMLElement>) { return <article className={`ui-data-card ${className}`} {...props} />; }
export function Spinner({ label = "Carregando" }: { label?: string }) { return <span className="ui-spinner" role="status"><i />{label}</span>; }

function useDismiss(active: boolean, close?: () => void) {
  const closeRef = useRef(close); closeRef.current = close;
  useEffect(() => { if (!active) return; const previous = document.body.style.overflow; document.body.style.overflow = "hidden"; const escape = (event: globalThis.KeyboardEvent) => { if (event.key === "Escape") closeRef.current?.(); }; document.addEventListener("keydown", escape); return () => { document.body.style.overflow = previous; document.removeEventListener("keydown", escape); }; }, [active]);
}
function initials(value: string) { return value.split(/\s+/).slice(0, 2).map((part) => part[0]?.toUpperCase()).join("") || "?"; }
function formatBytes(value: number) { if (value < 1024) return `${value} B`; if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} KB`; return `${(value / 1024 / 1024).toFixed(1)} MB`; }
