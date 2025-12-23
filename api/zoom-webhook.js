import crypto from "crypto";
import { createClient } from "@supabase/supabase-js";

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

/* ================================
   HELPER: Resolve Internal Role
================================ */
async function resolveInternalRole(email) {
  if (!email) return "student";

  const { data } = await supabase
    .from("zoom_internal_users")
    .select("role")
    .eq("email", email.toLowerCase())
    .maybeSingle();

  return data?.role || "student";
}

/* ================================
   HELPER: Get Live Meeting Roles
================================ */
async function getMeetingLiveRoles(meetingId) {
  const { data } = await supabase
    .from("zoom_meeting_events")
    .select("participant_role,event_type,created_at")
    .eq("meeting_id", String(meetingId))
    .order("created_at", { ascending: true });

  const active = new Set();

  for (const row of data || []) {
    if (row.event_type === "meeting.participant_joined") {
      active.add(row.participant_role);
    }
    if (row.event_type === "meeting.participant_left") {
      active.delete(row.participant_role);
    }
  }

  return {
    teacher: active.has("teacher"),
    sales: active.has("sales"),
    student: active.has("student"),
  };
}

/* ================================
   MAIN HANDLER
================================ */
export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(200).send("OK");
  }

  const { event, payload } = req.body;

  /* ================================
     ZOOM URL VALIDATION
  ================================ */
  if (event === "endpoint.url_validation") {
    const plainToken = payload.plainToken;

    const encryptedToken = crypto
      .createHmac("sha256", process.env.ZOOM_WEBHOOK_SECRET)
      .update(plainToken)
      .digest("hex");

    return res.status(200).json({ plainToken, encryptedToken });
  }

  /* ================================
     PARTICIPANT JOIN / LEAVE
  ================================ */
  if (
    event === "meeting.participant_joined" ||
    event === "meeting.participant_left"
  ) {
    const meetingId = payload.object.id;
    const meetingUUID = payload.object.uuid;

    const participant = payload.object.participant || {};
    const participantName = participant.user_name || null;
    const participantEmail = participant.email || null;

    const participantRole = await resolveInternalRole(participantEmail);

    const eventTime = new Date(payload.event_ts);

    await supabase.from("zoom_meeting_events").insert({
      meeting_id: String(meetingId),
      meeting_uuid: meetingUUID,
      event_type: event,
      participant_name: participantName,
      participant_email: participantEmail,
      participant_role: participantRole,
      join_time:
        event === "meeting.participant_joined" ? eventTime : null,
      leave_time:
        event === "meeting.participant_left" ? eventTime : null,
      payload,
    });

    /* ================================
       STEP 17: TEACHER LEFT LOGIC
    ================================ */
    if (event === "meeting.participant_left" && participantRole === "teacher") {
      const roles = await getMeetingLiveRoles(meetingId);

      console.log("MEETING STATE AFTER TEACHER LEFT:", roles);

      if (roles.sales || roles.student) {
        console.log(
          `Teacher left meeting ${meetingId} but meeting remains active`
        );
      }
    }

    return res.status(200).json({ status: "participant processed" });
  }

  /* ================================
     STORE ALL RAW EVENTS
  ================================ */
  await supabase.from("zoom_webhook_events").insert({
    event_type: event,
    zoom_meeting_id: payload?.object?.id?.toString() ?? null,
    zoom_account_email: payload?.account_id ?? null,
    payload,
  });

  return res.status(200).json({ status: "received" });
}
