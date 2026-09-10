export default {
  async scheduled(_controller, env, ctx) {
    ctx.waitUntil(fetch(`${env.BACKEND_URL}/api/push/dispatch-due`, {
      method: 'POST',
      headers: { 'X-Push-Cron-Secret': env.PUSH_CRON_SECRET }
    }));
  }
};
