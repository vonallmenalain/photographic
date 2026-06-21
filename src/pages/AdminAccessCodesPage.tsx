import { ArrowLeft, Printer, QrCode } from "lucide-react";
import { QRCodeSVG } from "qrcode.react";
import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { useAuth } from "../app/AuthProvider";
import { EmptyState, ErrorState, LoadingState } from "../components/PageState";
import { getJob, listChildren } from "../services/firestore";
import {
  callFunction,
  type GeneratedAccessCode,
  type GeneratedAccessCodesResponse
} from "../services/functions";
import type { ChildRecord, Job } from "../types/domain";

export function AdminAccessCodesPage() {
  const { jobId = "" } = useParams();
  const { user } = useAuth();
  const [job, setJob] = useState<Job | null>(null);
  const [children, setChildren] = useState<ChildRecord[]>([]);
  const [codes, setCodes] = useState<GeneratedAccessCode[]>([]);
  const [loading, setLoading] = useState(true);
  const [generating, setGenerating] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    async function loadData() {
      setLoading(true);
      setError("");
      try {
        const [jobRecord, childRecords] = await Promise.all([getJob(jobId), listChildren(jobId)]);
        setJob(jobRecord);
        setChildren(childRecords);
      } catch {
        setError("Codes konnten nicht vorbereitet werden.");
      } finally {
        setLoading(false);
      }
    }

    void loadData();
  }, [jobId]);

  async function generateCodes() {
    if (!user) {
      return;
    }

    setGenerating(true);
    setError("");
    try {
      const token = await user.getIdToken();
      const result = await callFunction<GeneratedAccessCodesResponse>(
        "admin-create-access-codes",
        { jobId },
        token
      );
      setCodes(result.codes);
    } catch (currentError) {
      setError(currentError instanceof Error ? currentError.message : "Codes konnten nicht erstellt werden.");
    } finally {
      setGenerating(false);
    }
  }

  if (loading) {
    return <LoadingState label="Access Codes werden geladen..." />;
  }

  return (
    <section className="page">
      <div className="print-hidden">
        <Link className="text-link" to="/admin">
          <ArrowLeft size={16} aria-hidden="true" />
          Zurück
        </Link>
      </div>
      <div className="page-header print-hidden">
        <div>
          <p className="eyebrow">Admin Access Codes</p>
          <h1>{job?.title ?? "Job"}</h1>
        </div>
        <div className="button-row">
          <button className="button primary" type="button" onClick={() => void generateCodes()} disabled={generating}>
            <QrCode size={18} aria-hidden="true" />
            Codes generieren
          </button>
          <button className="button secondary" type="button" onClick={() => window.print()} disabled={codes.length === 0}>
            <Printer size={18} aria-hidden="true" />
            Drucken
          </button>
        </div>
      </div>

      {error ? <ErrorState message={error} /> : null}

      {children.length === 0 ? (
        <EmptyState title="Keine Pseudonyme" body="Lege zuerst Pseudonyme für diesen Job an." />
      ) : null}

      {codes.length > 0 ? (
        <div className="code-sheet">
          {codes.map((code) => (
            <article className="code-card" key={code.accessCodeId}>
              <QRCodeSVG value={code.qrPayload} size={132} />
              <div>
                <span>{code.pseudonym}</span>
                <strong>{code.code}</strong>
                <small>Gültig bis {new Date(code.expiresAt).toLocaleDateString("de-CH")}</small>
              </div>
            </article>
          ))}
        </div>
      ) : (
        <div className="panel print-hidden">
          <p>{children.length} Pseudonyme bereit.</p>
        </div>
      )}
    </section>
  );
}
