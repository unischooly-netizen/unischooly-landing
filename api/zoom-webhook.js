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

  const eventType = req.body?.event;
  const payload = req.body?.payload;

  // ✅ 1) Zoom URL validation (keeps your "Validated" working)
  if (eventType === "endpoint.url_validation") {
    const plainToken = payload?.plainToken;

    const encryptedToken = crypto
      .createHmac("sha256", process.env.ZOOM_WEBHOOK_SECRET)
      .update(plainToken)
      .digest("hex");

    return res.status(200).json({ plainToken, encryptedToken });
  }

  // ✅ 2) Extract meeting id + host email from normal events
  const meetingObj = payload?.object;
  const zoomMeetingId = meetingObj?.id ? String(meetingObj.id) : null;
  const hostEmail = meetingObj?.host_email || null;

  // ✅ 3) Save raw event into Supabase table: zoom_webhook_events
  const { error } = await supabase.from("zoom_webhook_events").insert({
    event_type: eventType || "unknown",
    zoom_meeting_id: zoomMeetingId,
    zoom_account_email: hostEmail,
    payload: req.body,
  });

  if (error) {
    console.error("Supabase insert error:", error);
    // Still respond 200 so Zoom doesn't retry forever
    return res.status(200).json({ status: "received_with_db_error" });
  }

  return res.status(200).json({ status: "received" });
}
