import type { App } from "@slack/bolt";
import type { AchievementRequest, AchievementResponse } from "./types/achievement";
import { grabUser } from "../login";

export default async (app: App) => {
    const missingVars = [];
    if (!process.env.EDULINK_URL) missingVars.push("EDULINK_URL");
    if (!process.env.EDULINK_IDENTIFIER) missingVars.push("EDULINK_IDENTIFIER");
    if (!process.env.EDULINK_USERNAME) missingVars.push("EDULINK_USERNAME");
    if (!process.env.EDULINK_PASSWORD) missingVars.push("EDULINK_PASSWORD");

    if (missingVars.length > 0) {
        app.logger.warn("[EDULINK] Disabled due to missing environment variables:", missingVars.join(", "))
        return
    } else {
        async function getLastRun(): Promise<number | null> {
            let latest: number | null = null;
            const f = Bun.file("cache/achievementCache.json");
            if (await f.exists()) {
                const data = await f.json();
                if (data.lastRun) {
                    const ts = Number(data.lastRun);
                    if (!isNaN(ts) && (latest === null || ts > latest)) {
                        latest = ts;
                    }
                }
            }
            return latest;
        }
        async function grabAchievementAndPost() {
            const user = await grabUser(process.env.EDULINK_IDENTIFIER!, process.env.EDULINK_USERNAME!, process.env.EDULINK_PASSWORD!, process.env.EDULINK_URL!);

            const achievementResponse = await Bun.fetch(process.env.EDULINK_URL + "/api/?method=EduLink.Achievement", {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                    "X-API-Method": "EduLink.Achievement",
                    "Authorization": `Bearer ${user.result.authtoken}`
                },
                body: JSON.stringify(<AchievementRequest>{
                    jsonrpc: "2.0",
                    method: "EduLink.Achievement",
                    params: {
                        learner_id: Number(user.result.user.id)
                    },
                    uuid: Bun.randomUUIDv7(),
                    id: "1",
                }),
            });

            if (!achievementResponse.ok) {
                console.error(
                    "[ERROR] Failed to login! Status Code:",
                    achievementResponse.status,
                    achievementResponse.statusText
                );
                process.exit(1);
            }

            const achievementData = (await achievementResponse.json()) as AchievementResponse;

            if (!achievementData.result || !Array.isArray(achievementData.result.achievement)) {
                console.error("[EDULINK] Invalid achievement response:", achievementData);
                return;
            }

            const cacheFile = Bun.file("cache/achievementCache.json");
            let cachedAchievement: AchievementResponse.AchievementType[] = [];
            let achievementCache = {
                lastRun: Date.now(),
                data: achievementData
            };
            if (await cacheFile.exists()) {
                const cache = await cacheFile.json()
                cachedAchievement = cache.data.result.achievement;

                const newAchievements = achievementData.result.achievement.filter(
                    (b: AchievementResponse.AchievementType) => !cachedAchievement.some(c => c.id === b.id)
                );


                if (newAchievements.length > 0) {
                    const totalPoints = achievementData.result.achievement.reduce(
                        (sum, b) => sum + (Number(b.points) ?? 0),
                        0
                    );

                    app.client.chat.postMessage({ channel: String(process.env.CHANNEL), text: `Yipee new achievement points. Total Achievement Points ${totalPoints}` })
                }

                await Bun.write("cache/achievementCache.json", JSON.stringify(achievementCache, null, 2));
                return;
            } else {
                await Bun.write("cache/achievementCache.json", JSON.stringify(achievementCache, null, 2));
                return;
            }
        }

        const lastRun = await getLastRun();
        const now = Date.now();

        if (lastRun && now - lastRun < 10 * 60 * 1000) {
            const waitTime = 10 * 60 * 1000 - (now - lastRun);
            console.log(`[EdulinkOne - Achievement] Last check was less than 10 minutes ago. Waiting ${Math.ceil(waitTime / 1000)}s.`);
            setTimeout(grabAchievementAndPost, waitTime);
        } else {
            grabAchievementAndPost();
            setInterval(grabAchievementAndPost, 10 * 60 * 1000);
        }
    }
};
