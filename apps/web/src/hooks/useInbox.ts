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

  useEffect(() => {
    if (!session || !selectedLeadId) return;
    const leadId = selectedLeadId;
    // Always reset messages when switching leads, then populate from API
    setMessages([]);
    api
      .messages(session.token, leadId)
      .then((fetched) => {
        setMessages((current) => mergeUniqueMessages(fetched, current.filter((msg) => msg.leadId === leadId)));
      })
      .catch((err) => setError(err.message));
    
    api
      .notes(session.token, leadId)
      .then((items) => setNotes(uniqueById(items)))
      .catch(() => setNotes([]));
  }, [session, selectedLeadId]);

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
        handler: (message: any) => setMessages((items) => mergeUniqueMessages(items, [message as MessageDTO])),
      },
      {
        event: "message:status",
        handler: (message: any) => setMessages((items) => mergeUniqueMessages(items, [message as MessageDTO])),
      },
    ],
    []
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
