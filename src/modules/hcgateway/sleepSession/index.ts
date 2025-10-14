import type { App } from "@slack/bolt";
import type { SleepSessionResponse } from "./types/sleepSession";
import { grabData } from "../fetch";
import { grabUser } from "../login";
import { DateTime, Interval } from "luxon";

export default async (app: App) => {
    const missingVars = [];

    if (!process.env.HC_GATEWAY_SERVER) missingVars.push("HC_GATEWAY_SERVER");
    if (!process.env.HC_GATEWAY_USERNAME) missingVars.push("HC_GATEWAY_USERNAME");
    if (!process.env.HC_GATEWAY_PASSWORD) missingVars.push("HC_GATEWAY_PASSWORD");
    if (!process.env.CHANNEL) missingVars.push("CHANNEL");

    if (missingVars.length > 0) {
        console.warn("[HC_GATEWAY] Disabled due to missing environment variables:", missingVars.join(", "));
        return;
    }

    async function getLastRun(): Promise<{ latest: number | null; lastPostedId?: string }> {
        const f = Bun.file("cache/sleepCache.json");
        if (await f.exists()) {
            const data = await f.json();
            return {
                latest: data.lastRun ?? null,
                lastPostedId: data.lastPostedId ?? null
            };
        }
        return { latest: null };
    }

    async function grabSleepAndPost() {
        const user = await grabUser(
            process.env.HC_GATEWAY_SERVER!,
            process.env.HC_GATEWAY_USERNAME!,
            process.env.HC_GATEWAY_PASSWORD!
        );

        if (user.token.length === 0) return;

        const cacheFile = Bun.file("cache/sleepCache.json");
        let cache: {
            lastRun?: number;
            lastPostedId?: string;
            data?: SleepSessionResponse;
        } = {};

        if (await cacheFile.exists()) {
            cache = await cacheFile.json();
        }

        const data = (await grabData(
            process.env.HC_GATEWAY_SERVER!,
            "sleepSession",
            {},
            user.token
        )) as SleepSessionResponse;

        if (!Array.isArray(data) || data.length === 0) {
            console.log("[HC_GATEWAY - Sleep] No sleep sessions found.");
            return;
        }

        const sorted = data.sort(
            (a, b) => DateTime.fromISO(a.start).toMillis() - DateTime.fromISO(b.start).toMillis()
        );

        const now = DateTime.now().setZone("Europe/London");
        const today = now.startOf("day");

        const nightStart = today.minus({ days: 1 }).plus({ hours: 22 });
        const nightEnd = today.plus({ hours: 8 });
        const nightInterval = Interval.fromDateTimes(nightStart, nightEnd);

        const nightSessions = sorted.filter(s => {
            const start = DateTime.fromISO(s.start);
            const end = DateTime.fromISO(s.end);
            return nightInterval.overlaps(Interval.fromDateTimes(start, end));
        });

        if (nightSessions.length === 0) {
            console.log("[HC_GATEWAY - Sleep] No sessions found for the night window.");
            return;
        }

        let totalMinutes = 0;
        let sleepStart: DateTime | null = null;
        let sleepEnd: DateTime | null = null;
        for (const s of nightSessions) {
            const start = DateTime.fromISO(s.start);
            const end = DateTime.fromISO(s.end);
            const overlap = nightInterval.intersection(Interval.fromDateTimes(start, end));
            if (overlap) {
                totalMinutes += overlap.toDuration("minutes").minutes;
                if (!sleepStart || start < sleepStart) sleepStart = overlap.start;
                if (!sleepEnd || end > sleepEnd) sleepEnd = overlap.end;
            }
        }

        const totalHours = Math.floor(totalMinutes / 60);
        const totalMins = Math.round(totalMinutes % 60);

        const details = nightSessions
            .map(s => {
                const start = DateTime.fromISO(s.start).setZone("Europe/London");
                const end = DateTime.fromISO(s.end).setZone("Europe/London");
                const dur = end.diff(start, ["hours", "minutes"]);
                return `• ${start.toFormat("HH:mm")} → ${end.toFormat("HH:mm")} (${Math.floor(dur.hours)}h ${Math.round(dur.minutes)}m)`;
            })
            .join("\n");

        const lastSleep = nightSessions[nightSessions.length - 1];

        if (cache.lastPostedId === lastSleep?.id) {
            console.log("[HC_GATEWAY - Sleep] Last sleep already posted, skipping.");
        } else {
            const message = `Woah eep time?\nTotal eep: ${totalHours}h ${totalMins}m between ${sleepStart?.toFormat("HH:mm")}–${sleepEnd?.toFormat("HH:mm")}\n\nSleep sessions:\n${details}`;

            await app.client.chat.postMessage({
                channel: String(process.env.CHANNEL),
                text: message
            });

            cache = {
                lastRun: Date.now(),
                lastPostedId: lastSleep?.id,
                data
            };


            await Bun.write("cache/sleepCache.json", JSON.stringify(cache, null, 2));
            console.log("[HC_GATEWAY - Sleep] Posted full night sleep summary.");
        }

    }

    const lastRun = await getLastRun();
    const now = Date.now();

    if (lastRun.latest && now - lastRun.latest < (Number(process.env.INTERVAL) || 15) * 60 * 1000) {
        const waitTime = (Number(process.env.INTERVAL) || 15) * 60 * 1000 - (now - lastRun.latest);
        console.log(
            `[HC_GATEWAY - Sleep Session] Last check was less than the interval. Waiting ${Math.ceil(waitTime / 1000)}s.`
        );
        setTimeout(grabSleepAndPost, waitTime);
    } else {
        grabSleepAndPost();
        setInterval(grabSleepAndPost, (Number(process.env.INTERVAL) || 15) * 60 * 1000);
    }
};
