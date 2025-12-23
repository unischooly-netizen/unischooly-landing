import crypto from "crypto";
import { createClient } from "@supabase/supabase-js";

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(200).send("OK");
  }

  const event = req.body?.event;
  const payload = req.body?.payload;

  // 🔐 Zoom URL validation (DO NOT TOUCH)
  if (event === "endpoint.url_validation") {
    const plainToken = payload.plainToken;

    const encryptedToken = crypto
      .createHmac("sha256", process.env.ZOOM_WEBHOOK_SECRET)
      .update(plainToken)
      .digest("hex");

    return res.status(200).json({
      plainToken,
      encryptedToken,
    });
  }

  try {
    // 🧠 Extract useful data safely
    const meetingId = payload?.object?.id?.toString() || null;
    const meetingUUID = payload?.object?.uuid || null;

    const participant =
      payload?.object?.participant || payload?.object?.participants?.[0] || {};

    const joinTime =
      payload?.object?.join_time || payload?.object?.start_time || null;

    const leaveTime =
      payload?.object?.leave_time || payload?.object?.end_time || null;

    const participantRole =
      participant?.role || payload?.object?.host_id ? "host" : "attendee";

    // 💾 Save event in Supabase
    await supabase.from("zoom_meeting_events").insert([
      {
        meeting_id: meetingId,
        meeting_uuid: meetingUUID,
        event_type: event,
        participant_name: participant?.user_name || null,
        participant_email: participant?.email || null,
        participant_role: participantRole,
        join_time: joinTime,
        leave_time: leaveTime,
        payload: req.body, // store full raw event
      },
    ]);
  } catch (error) {
    console.error("Zoom webhook error:", error);
    // IMPORTANT: still return 200 or Zoom will retry endlessly
  }

  return res.status(200).json({ status: "received" });
}
