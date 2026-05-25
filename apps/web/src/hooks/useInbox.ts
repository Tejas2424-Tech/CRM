import { useCallback, useEffect, useMemo, useState } from "react";
import type { MessageDTO, NoteDTO } from "@crm/shared";
import { api, type Session } from "../api";
import { mergeUniqueMessages, uniqueById } from "../utils";

export function useInbox(session: Session | undefined, selectedLeadId: string | undefined, markLeadUnreadAsZero: (id: string) => void) {
  const [messages, setMessages] = useState<MessageDTO[]>([]);
  const [notes, setNotes] = useState<NoteDTO[]>([]);
  const [reply, setReply] = useState("");
  const [noteBody, setNoteBody] = useState("");
  const [error, setError] = useState<string>();
  const debugMessageSync = import.meta.env.DEV && localStorage.getItem("crm:debug:message-sync") === "1";

  const loadMessages = useCallback(
    async (leadId: string) => {
      if (!session) return;
      const fetched = await api.messages(session.token, leadId);
      if (debugMessageSync) {
        console.debug(`[MessageSync][Inbox] lead=${leadId} fetched=${fetched.length}`);
      }
      setMessages((current) =>
        mergeUniqueMessages(
          fetched,
          current.filter((msg) => msg.leadId === leadId)
        )
      );
    },
    [session, debugMessageSync]
  );

  useEffect(() => {
    if (!session || !selectedLeadId) return;
    const leadId = selectedLeadId;
    let cancelled = false;
    // Always reset messages when switching leads, then populate from API
    setMessages([]);
    api
      .messages(session.token, leadId)
      .then((fetched) => {
        if (cancelled) return;
        if (debugMessageSync) {
          console.debug(`[MessageSync][Inbox] lead=${leadId} fetched=${fetched.length}`);
        }
        setMessages((current) => mergeUniqueMessages(fetched, current.filter((msg) => msg.leadId === leadId)));
      })
      .catch((err) => setError(err.message));
    
    api
      .notes(session.token, leadId)
      .then((items) => {
        if (!cancelled) setNotes(uniqueById(items));
      })
      .catch(() => {
        if (!cancelled) setNotes([]);
      });

    return () => {
      cancelled = true;
    };
  }, [session, selectedLeadId, debugMessageSync]);

  const sendReply = useCallback(async () => {
    if (!session || !selectedLeadId || !reply.trim()) return;
    const text = reply.trim();
    setReply(""); // Clear immediately for snappy UX
    try {
      const sent = await api.sendMessage(session.token, selectedLeadId, text);
      setMessages((items) => mergeUniqueMessages(items, [sent.message]));
      markLeadUnreadAsZero(selectedLeadId);
    } catch (err: any) {
      setError(err.message ?? "Failed to send message");
      setReply(text); // Restore reply on failure
    }
  }, [session, selectedLeadId, reply, markLeadUnreadAsZero]);

  const createNote = useCallback(async () => {
    if (!session || !selectedLeadId || !noteBody.trim()) return;
    try {
      const note = await api.createNote(session.token, selectedLeadId, noteBody.trim());
      setNotes((items) => uniqueById([note, ...items]));
      setNoteBody("");
    } catch (err: any) {
      setError(err.message);
    }
  }, [session, selectedLeadId, noteBody]);

  const socketEvents = useMemo(
    () => [
      {
        event: "message:new",
        handler: (message: any) => {
          const incoming = message as MessageDTO;
          if (incoming.leadId !== selectedLeadId) return;
          setMessages((items) => mergeUniqueMessages(items.filter((msg) => msg.leadId === selectedLeadId), [incoming]));
        },
      },
      {
        event: "message:status",
        handler: (message: any) => {
          const incoming = message as MessageDTO;
          if (incoming.leadId !== selectedLeadId) return;
          setMessages((items) => mergeUniqueMessages(items.filter((msg) => msg.leadId === selectedLeadId), [incoming]));
        },
      },
      {
        event: "message:sync_complete",
        handler: (payload: any) => {
          const event = payload as { leadId?: string; newMessages?: number };
          if (!selectedLeadId || event.leadId !== selectedLeadId) return;
          loadMessages(selectedLeadId).catch((err) => setError(err.message));
        },
      },
    ],
    [loadMessages, selectedLeadId]
  );

  return {
    messages,
    notes,
    reply,
    setReply,
    noteBody,
    setNoteBody,
    sendReply,
    createNote,
    socketEvents,
    error,
    setError,
  };
}
