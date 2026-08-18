import { CheckCircle2, TriangleAlert, X } from "lucide-react";

export function Feedback({ kind, message, onClose }: { kind: "success" | "error"; message: string; onClose?: () => void }) {
  return <div className={`feedback ${kind}`} role={kind === "error" ? "alert" : "status"}>{kind === "success" ? <CheckCircle2 /> : <TriangleAlert />}<span>{message}</span>{onClose ? <button aria-label="Fechar" onClick={onClose}><X /></button> : null}</div>;
}

export function SkeletonTable() {
  return <div className="skeleton-table" aria-label="Carregando dados">{Array.from({ length: 6 }, (_, index) => <div key={index}><span /><span /><span /><span /></div>)}</div>;
}
