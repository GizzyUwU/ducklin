import type { App } from "@slack/bolt";
import type { StepsResponse, StepsItem } from "./types/steps";
import { grabData } from "../fetch";
import { grabUser } from "../login";
import { DateTime } from "luxon";
let postEODData = false;

export default async (app: App) => {
    const missingVars = [];

    if (!process.env.HC_GATEWAY_SERVER) missingVars.push("HC_GATEWAY_SERVER");
    if (!process.env.HC_GATEWAY_USERNAME) missingVars.push("HC_GATEWAY_USERNAME");
    if (!process.env.HC_GATEWAY_PASSWORD) missingVars.push("HC_GATEWAY_PASSWORD");

    if (missingVars.length > 0) {
        console.warn("[HC_GATEWAY] Disabled due to missing environment variables:", missingVars.join(", "))
        return;
    } else {
        async function getLastRun(): Promise<{ latest: number | null, eodPosted: boolean }> {
            let latest: number | null = null;
            let eodPosted: boolean = false;
            const f = Bun.file("cache/stepsCache.json");
            if (await f.exists()) {
                const data = await f.json();
                if (data.lastRun) {
                    const ts = Number(data.lastRun);
                    if (!isNaN(ts) && (latest === null || ts > latest)) {
                        latest = ts;
                    }
                }
                if (data.eodPosted) {
                    eodPosted = true;
                }
            }
            return { latest, eodPosted }
        }

        async function grabStepsAndPost() {
            const user = await grabUser(process.env.HC_GATEWAY_SERVER!, process.env.HC_GATEWAY_USERNAME!, process.env.HC_GATEWAY_PASSWORD!);
            if (user.token.length > 0) {
                const cacheFile = Bun.file("cache/stepsCache.json");
                const todayStart = DateTime.now().toUTC().startOf("day").toISO();
                const todayEnd = DateTime.now().toUTC().endOf("day").toISO();
                let stepsCache: {
                    lastRun?: number;
                    data?: StepsResponse;
                    eodPosted?: boolean;
                } = {};

                if (await cacheFile.exists()) {
                    stepsCache = await cacheFile.json()
                }

                const data = await grabData(process.env.HC_GATEWAY_SERVER!, "steps", {
                    start: { $gte: todayStart, $lte: todayEnd }
                }, user.token) as StepsResponse;

                const newData = data.filter(
                    (b: StepsItem) => !stepsCache.data?.some(c => c.id === b.id)
                );


                if (newData.length > 0) {
                    const newSteps = newData.reduce((sum, item) => sum + (item.data.count ?? 0), 0);
                    const totalSteps = data.reduce((sum, item) => sum + (item.data.count ?? 0), 0);

                    if (!postEODData) {
                        await app.client.chat.postMessage({
                            channel: String(process.env.CHANNEL),
                            text: `${newSteps} steps added. Total steps today is ${totalSteps} `
                        })
                    } else {
                        await app.client.chat.postMessage({
                            channel: String(process.env.CHANNEL),
                            text: `Woah end of day already? Damn anyway the total of steps today is ${totalSteps}!`
                        })
                    }
                }

                if (postEODData) {
                    stepsCache = {
                        lastRun: Date.now(),
                        data,
                        eodPosted: true
                    }
                } else {
                    stepsCache = {
                        lastRun: Date.now(),
                        data
                    }
                }

                await Bun.write("cache/stepsCache.json", JSON.stringify(stepsCache, null, 2))
            }
        }

        const lastRun = await getLastRun();
        const now = Date.now()
        if (lastRun && now - lastRun.latest! < 70 * 60 * 1000) {
            const waitTime = 70 * 60 * 1000 - (now - lastRun.latest!);
            console.log(`[HC_GATEWAY - Steps] Last post was less than 60 minutes ago. Waiting ${Math.ceil(waitTime / 1000)}s.`);
            setTimeout(grabStepsAndPost, waitTime);
        } else {
            const londonNow = DateTime.now().setZone("Europe/London");
            const eod = londonNow.hour >= 23;
            if (eod && !lastRun.eodPosted) {
                postEODData = true
            }
            grabStepsAndPost();
            setInterval(grabStepsAndPost, 70 * 60 * 1000);
        }
    }
}