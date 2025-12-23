import crypto from "crypto";
import { createClient } from "@supabase/supabase-js";

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

/**
 * Zoom sends event_ts sometimes in seconds, sometimes in ms.
 * This converts safely to ISO string (Supabase-friendly).
 */
function zoomEventTsToISO(eventTs) {
  if (!eventTs) return null;

  // If it's already a string date, try parsing
  if (typeof eventTs === "string") {
    const d = new Date(eventTs);
    return isNaN(d.getTime()) ? null : d.toISOString();
  }

  // If number: determine seconds vs ms
  if (typeof eventTs === "number") {
    // seconds are ~1,700,000,000; ms are ~1,700,000,000,000
    const ms = eventTs < 10_000_000_000 ? eventTs * 1000 : eventTs;
    const d = new Date(ms);
    return isNaN(d.getTime()) ? null : d.toISOString();
  }

  return null;
}

/**
 * Internal role resolution:
 * - host/co-host => teacher
 * - else if participant.email exists and in zoom_internal_users => use that role
 * - else if participant.user_name exists and matches zoom_internal_users.display_name => use that role
 * - else => student
 */
async function resolveParticipantRole(participant) {
  const zoomRole = participant?.role || null; // host/co-host/attendee etc.
  const email = participant?.email || null;
  const name = participant?.user_name || null;

  // 1) Zoom role is the most reliable when present
  if (zoomRole === "host" || zoomRole === "co-host") {
    return "teacher";
  }

  // 2) Lookup by email (best)
  if (email) {
    const { data, error } = await supabase
      .from("zoom_internal_users")
      .select("role")
      .eq("email", email)
      .maybeSingle();

    if (!error && data?.role) return data.role;
  }

  // 3) If email missing (Guest), lookup by display_name
  // IMPORTANT: Put exact Zoom display names in zoom_internal_users.display_name
  if (name) {
    const { data, error } = await supabase
      .from("zoom_internal_users")
      .select("role")
      .eq("display_name", name)
      .maybeSingle();

    if (!error && data?.role) return data.role;
  }

  // 4) Default
  return "student";
}

export default async function handler(req, res) {
  // Zoom sometimes hits GET to validate your endpoint
  if (req.method !== "POST") return res.status(200).send("OK");

  const { event, payload } = req.body || {};
  console.log("ZOOM EVENT:", event);

  // 1) Zoom URL validation (required by Zoom)
  if (event === "endpoint.url_validation") {
    const plainToken = payload?.plainToken;
    const encryptedToken = crypto
      .createHmac("sha256", process.env.ZOOM_WEBHOOK_SECRET)
      .update(plainToken)
      .digest("hex");

    return res.status(200).json({ plainToken, encryptedToken });
  }

  // 2) Store ALL events (debug + audit)
  try {
    await supabase.from("zoom_webhook_events").insert({
      event_type: event || null,
      zoom_meeting_id: payload?.object?.id?.toString() ?? null,
      zoom_account_email: payload?.account_id ?? null,
      payload: payload ?? null,
    });
  } catch (e) {
    console.error("Failed to insert zoom_webhook_events:", e);
  }

  // Extract meeting basics
  const meetingId = payload?.object?.id ? String(payload.object.id) : null;
  const meetingUUID = payload?.object?.uuid ?? null;

  // 3) Participant join/leave
  if (event === "meeting.participant_joined" || event === "meeting.participant_left") {
    const participant = payload?.object?.participant || {};
    const participantName = participant?.user_name ?? null;
    const participantEmail = participant?.email ?? null;

    const participantRole = await resolveParticipantRole(participant);
    const tsISO = zoomEventTsToISO(payload?.event_ts);

    const join_time = event === "meeting.participant_joined" ? tsISO : null;
    const leave_time = event === "meeting.participant_left" ? tsISO : null;

    await supabase.from("zoom_meeting_events").insert({
      meeting_id: meetingId,
      meeting_uuid: meetingUUID,
      event_type: event,
      participant_name: participantName,
      participant_email: participantEmail,
      participant_role: participantRole,
      join_time,
      leave_time,
      payload: payload?.object ?? null,
    });

    return res.status(200).json({ status: "participant event saved" });
  }

  // 4) Recording completed (THIS is where you get shareable links)
  // Zoom can send: recording.completed (most useful), recording.stopped (sometimes), recording.started
  if (event === "recording.completed" || event === "recording.stopped") {
    const hostEmail = payload?.object?.host_email ?? null;
    const files = payload?.object?.recording_files ?? [];

    for (const file of files) {
      // file.play_url is usually the "shareable viewing" link (depends on Zoom settings)
      // file.download_url usually needs an access token unless the recording is public/shared.
      await supabase.from("zoom_meeting_events").insert({
        meeting_id: meetingId,
        meeting_uuid: meetingUUID,
        event_type: event,
        participant_name: file?.recording_type ?? "recording",
        participant_email: hostEmail,
        participant_role: "system",
        join_time: file?.recording_start ?? null,
        leave_time: file?.recording_end ?? null,
        payload: file,
      });
    }

    return res.status(200).json({ status: "recording files saved" });
  }

  return res.status(200).json({ status: "received" });
}
