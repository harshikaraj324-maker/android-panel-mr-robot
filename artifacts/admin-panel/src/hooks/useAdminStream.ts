import { useEffect, useRef, useCallback } from "react";
import type { FormDataRow, MessageRow } from "@/lib/api";

const _apiBase = (import.meta.env.VITE_API_BASE_URL as string | undefined) ?? "";

interface AdminStreamCallbacks {
  onMessage?: (row: MessageRow) => void;
  onFormData?: (row: FormDataRow) => void;
}

export function useAdminStream({ onMessage, onFormData }: AdminStreamCallbacks) {
  const esRef = useRef<EventSource | null>(null);
  const reconnectRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const callbacksRef = useRef({ onMessage, onFormData });
  callbacksRef.current = { onMessage, onFormData };

  const connect = useCallback(() => {
    const token = localStorage.getItem("admin_token");
    if (!token) return;

    esRef.current?.close();
    const url = `${_apiBase}/api/admin/stream?token=${encodeURIComponent(token)}`;
    const es = new EventSource(url);
    esRef.current = es;

    es.onmessage = (e) => {
      try {
        const parsed = JSON.parse(e.data) as { type: string; row: Record<string, unknown> };
        if (parsed.type === "message" && parsed.row) {
          callbacksRef.current.onMessage?.(parsed.row as unknown as MessageRow);
        } else if (parsed.type === "form_data" && parsed.row) {
          callbacksRef.current.onFormData?.(parsed.row as unknown as FormDataRow);
        }
      } catch {}
    };

    es.onerror = () => {
      es.close();
      esRef.current = null;
      clearTimeout(reconnectRef.current);
      reconnectRef.current = setTimeout(connect, 500);
    };
  }, []);

  useEffect(() => {
    connect();
    return () => {
      esRef.current?.close();
      clearTimeout(reconnectRef.current);
    };
  }, [connect]);
}
