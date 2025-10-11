import type { App } from "@slack/bolt";
import type { BehaviourRequest, BehaviourResponse } from "./types/behaviour";
import { grabUser } from "../login";
import { DateTime } from "luxon";

export default async (app: App) => {
    const missingVars = [];
    const postedThisRun = new Set<string>();

    if (!process.env.EDULINK_URL) missingVars.push("EDULINK_URL");
    if (!process.env.EDULINK_IDENTIFIER) missingVars.push("EDULINK_IDENTIFIER");
    if (!process.env.EDULINK_USERNAME) missingVars.push("EDULINK_USERNAME");
    if (!process.env.EDULINK_PASSWORD) missingVars.push("EDULINK_PASSWORD");

    if (missingVars.length > 0) {
        app.logger.warn("[EDULINK] Disabled due to missing environment variables:", missingVars.join(", "))
        return
    } else {
        async function grabBehaviourAndPost() {
            const user = await grabUser(process.env.EDULINK_IDENTIFIER!, process.env.EDULINK_USERNAME!, process.env.EDULINK_PASSWORD!, process.env.EDULINK_URL!);

            const behaviourResponse = await Bun.fetch(process.env.EDULINK_URL + "/api/?method=EduLink.Behaviour", {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                    "X-API-Method": "EduLink.Behaviour",
                    "Authorization": `Bearer ${user.result.authtoken}`
                },
                body: JSON.stringify(<BehaviourRequest>{
                    jsonrpc: "2.0",
                    method: "EduLink.Behaviour",
                    params: {
                        learner_id: Number(user.result.user.id)
                    },
                    uuid: Bun.randomUUIDv7(),
                    id: "1",
                }),
            });

            if (!behaviourResponse.ok) {
                console.error(
                    "[ERROR] Failed to login! Status Code:",
                    behaviourResponse.status,
                    behaviourResponse.statusText
                );
                process.exit(1);
            }

            const behaviourData = (await behaviourResponse.json()) as BehaviourResponse;

            if (!behaviourData.result || !Array.isArray(behaviourData.result.behaviour)) {
                console.error("[EDULINK] Invalid behaviour response:", behaviourData);
                return;
            }

            const cacheFile = Bun.file("behaviourCache.json");
            let cachedBehaviour: BehaviourResponse.BehaviourType[] = [];
            if (!await cacheFile.exists()) {
                await Bun.write("behaviourCache.json", JSON.stringify(behaviourData, null, 2));
                return;
            } else {
                const cache = await cacheFile.json()
                cachedBehaviour = cache.result.behaviour;
            }

            const newBehaviours = behaviourData.result.behaviour.filter(
                (b: BehaviourResponse.BehaviourType) => !cachedBehaviour.some(c => c.id === b.id)
            );

            await Bun.write("behaviourCache.json", JSON.stringify(behaviourData, null, 2));

            if (newBehaviours.length > 0) {
                const totalPoints = behaviourData.result.behaviour.reduce(
                    (sum, b) => sum + (b.points ?? 0),
                    0
                );

                app.client.chat.postMessage({ channel: String(process.env.CHANNEL), text: `Woah a behaviour point has been added. Total Behaviour Points ${totalPoints}` })
            }

            const detentionCacheFile = Bun.file("detentionCache.json");
            let sentDetentionIds: Set<string | number> = new Set();
            let cachedDetentions: BehaviourResponse.DetentionsType[] = [];

            if (await detentionCacheFile.exists()) {
                const cacheJson = await detentionCacheFile.json() as {
                    sentDetentions?: Array<string | number>;
                    detentions?: BehaviourResponse.DetentionsType[];
                };

                if (cacheJson.sentDetentions) sentDetentionIds = new Set(cacheJson.sentDetentions);
                if (cacheJson.detentions) cachedDetentions = cacheJson.detentions;
            }

            const currentDetentions = behaviourData.result.detentions ?? [];
            const newDetentions = currentDetentions.filter(
                d => !cachedDetentions.some(c => c.id === d.id)
            );
            if (newDetentions.length > 0) {
                for (const detention of newDetentions) {
                    postedThisRun.add(detention.id.toString());
                }

                for (const detention of newDetentions) {
                    const idStr = detention.id.toString();
                    if (postedThisRun.has(idStr + "-posted")) continue;
                    const detentionDate = DateTime.fromISO(detention.date, { zone: "Europe/London" });
                    const startTime = DateTime.fromISO(detention.start_time, { zone: "Europe/London" });

                    const detentionStart = detentionDate.set({
                        hour: startTime.hour,
                        minute: startTime.minute,
                        second: startTime.second ?? 0,
                        millisecond: startTime.millisecond ?? 0,
                    });

                    const formatted = detentionStart.toLocaleString(DateTime.DATETIME_MED_WITH_WEEKDAY);
                    try {
                        postedThisRun.add(idStr + "-posted");
                        const res = await app.client.chat.postMessage({
                            channel: String(process.env.CHANNEL),
                            text: `Woah new detention on ${formatted}`,
                        });
                        if(!res.ok) {
                            console.error(res.error || res.errors)
                        }
                    } catch (err) {
                        console.error("Failed to post detention message", err);
                    }
                    continue;
                }
            }

            const now = DateTime.now().setZone("Europe/London");
            for (const detention of currentDetentions) {
                if (await detentionCacheFile.exists()) {
                    const detentionDate = DateTime.fromISO(detention.date, { zone: "Europe/London" });
                    const startTime = DateTime.fromISO(detention.start_time, { zone: "Europe/London" });
                    const detentionStart = detentionDate.set({
                        hour: startTime.hour,
                        minute: startTime.minute,
                        second: startTime.second,
                        millisecond: startTime.millisecond
                    });

                    const today = now.hasSame(detentionDate, "day");

                    if (today && !sentDetentionIds.has(detention.id)) {
                        const delay = detentionStart.diffNow().as("milliseconds");

                        if (delay > 0) {
                            setTimeout(async () => {
                                await app.client.chat.postMessage({
                                    channel: String(process.env.CHANNEL),
                                    text: `Woah detention rn smh`,
                                });
                                sentDetentionIds.add(detention.id);
                                await Bun.write(
                                    "detentionCache.json",
                                    JSON.stringify({
                                        sentDetentions: Array.from(sentDetentionIds),
                                        detentions: currentDetentions,
                                    }, null, 2)
                                );
                            }, delay);
                        }
                    }
                }
            }

            await Bun.write(
                "detentionCache.json",
                JSON.stringify({
                    sentDetentions: Array.from(sentDetentionIds),
                    detentions: currentDetentions,
                }, null, 2)
            );
            return;
        }

        grabBehaviourAndPost();

        setTimeout(() => grabBehaviourAndPost(), 10 * 60 * 1000);
    }
};
