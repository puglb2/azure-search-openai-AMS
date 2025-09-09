import { cfg } from "../shared/config.js";

export default async function (context, req) {
  try {
    const body = req.body || {};
    const { providerId, slotId, patient } = body;
    if (!providerId || !slotId || !patient) {
      context.res = { status: 400, body: { error: "providerId, slotId, patient required" } };
      return;
    }
    // TODO: call EMR adapter here using cfg.emrBaseUrl/credentials
    // For now, simulate success
    const appointmentId = "apt_" + Math.random().toString(36).slice(2, 10);
    context.res = { status: 200, body: { appointmentId, providerId, slotId } };
  } catch (e) {
    context.log("schedule error", e);
    context.res = { status: 500, body: { error: "server error" } };
  }
}
