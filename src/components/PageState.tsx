import { AlertCircle, ImageOff, LoaderCircle } from "lucide-react";

export function LoadingState({ label = "Lädt..." }: { label?: string }) {
  return (
    <div className="state-box">
      <LoaderCircle className="spin" size={24} aria-hidden="true" />
      <p>{label}</p>
    </div>
  );
}

export function EmptyState({ title, body }: { title: string; body: string }) {
  return (
    <div className="state-box">
      <ImageOff size={24} aria-hidden="true" />
      <h2>{title}</h2>
      <p>{body}</p>
    </div>
  );
}

export function ErrorState({ message }: { message: string }) {
  return (
    <div className="state-box error">
      <AlertCircle size={24} aria-hidden="true" />
      <p>{message}</p>
    </div>
  );
}
