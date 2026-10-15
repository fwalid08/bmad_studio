"use client";

import { createContext, useCallback, useContext, useEffect, useRef, useState } from "react";
import type { ReactNode } from "react";
import { AlertTriangle, CheckCircle2, Info, X } from "lucide-react";
import { cn } from "@/lib/utils";

type NotificationKind = "success" | "error" | "info";

type NotificationInput = {
  kind: NotificationKind;
  title: string;
  description?: string;
};

type NotificationItem = NotificationInput & { id: number };

const NotificationContext = createContext<((notification: NotificationInput) => void) | null>(null);

function NotificationToast({ notification, onDismiss }: { notification: NotificationItem; onDismiss: (id: number) => void }) {
  const Icon = notification.kind === "success" ? CheckCircle2 : notification.kind === "error" ? AlertTriangle : Info;

  useEffect(() => {
    const timeout = window.setTimeout(() => onDismiss(notification.id), 5000);
    return () => window.clearTimeout(timeout);
  }, [notification.id, onDismiss]);

  return (
    <div
      role={notification.kind === "error" ? "alert" : "status"}
      aria-live={notification.kind === "error" ? "assertive" : "polite"}
      className={cn(
        "flex items-start gap-3 rounded-md border bg-background p-3 shadow-lg",
        notification.kind === "success" && "border-emerald-500/40",
        notification.kind === "error" && "border-red-500/40",
        notification.kind === "info" && "border-sky-500/40"
      )}
    >
      <Icon
        className={cn(
          "mt-0.5 size-4 shrink-0",
          notification.kind === "success" && "text-emerald-600",
          notification.kind === "error" && "text-red-600",
          notification.kind === "info" && "text-sky-600"
        )}
      />
      <div className="min-w-0 flex-1">
        <p className="text-sm font-semibold">{notification.title}</p>
        {notification.description && <p className="mt-0.5 break-words text-xs text-muted-foreground">{notification.description}</p>}
      </div>
      <button type="button" className="rounded p-1 text-muted-foreground hover:bg-muted hover:text-foreground" aria-label="Tutup notifikasi" onClick={() => onDismiss(notification.id)}>
        <X className="size-3.5" />
      </button>
    </div>
  );
}

export function NotificationProvider({ children }: { children: ReactNode }) {
  const [notifications, setNotifications] = useState<NotificationItem[]>([]);
  const nextId = useRef(0);

  const notify = useCallback((notification: NotificationInput) => {
    const id = ++nextId.current;
    setNotifications((current) => [...current, { ...notification, id }].slice(-4));
  }, []);

  const dismiss = useCallback((id: number) => {
    setNotifications((current) => current.filter((notification) => notification.id !== id));
  }, []);

  return (
    <NotificationContext.Provider value={notify}>
      {children}
      <div className="fixed bottom-4 right-4 z-[100] flex max-h-[calc(100dvh-2rem)] w-[min(24rem,calc(100vw-2rem))] flex-col gap-2 overflow-y-auto" aria-label="Notifikasi">
        {notifications.map((notification) => (
          <NotificationToast key={notification.id} notification={notification} onDismiss={dismiss} />
        ))}
      </div>
    </NotificationContext.Provider>
  );
}

export function useNotifications() {
  const notify = useContext(NotificationContext);
  if (!notify) throw new Error("useNotifications must be used within NotificationProvider");
  return notify;
}