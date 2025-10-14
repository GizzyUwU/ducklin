import type { App } from "@slack/bolt";
import type { TrackQueryRequest, TrackQueryResponse, ResultListItem } from "./types/trackQuery";
import { DateTime } from "luxon";

export default async (app: App) => {
    const missingVars: string[] = [];
    if (!process.env.YUNEXPRESS_ID) missingVars.push("YUNEXPRESS_ID");
    if (!process.env.YUNEXPRESS_REFERER) missingVars.push("YUNEXPRESS_REFERER");
    if (missingVars.length > 0) return app.logger.warn("[YunExpress] Disabled due to missing environment variables:", missingVars.join(", "));

    function getSign(message: string) {
        const key = "f3c42837e3b46431ddf5d7db7d67017d";
        const hasher = new Bun.CryptoHasher("sha256", key);
        hasher.update(message);
        return hasher.digest("hex");
    }

    async function getLastRun(): Promise<number | null> {
        let latest: number | null = null;
        const f = Bun.file("cache/yunExpress.json");
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

    async function grabPackageDataAndPost() {
        const ids = Array.isArray(process.env.YUNEXPRESS_ID)
            ? process.env.YUNEXPRESS_ID
            : [process.env.YUNEXPRESS_ID].filter(Boolean);

        const timestamp = Date.now();
        const e = `Timestamp=${timestamp}&NumberList=${JSON.stringify(ids)}`;
        const signature = getSign(e);
        const response = await Bun.fetch("https://services.yuntrack.com/Track/Query", {
            method: "POST",
            headers: {
                "Host": "services.yuntrack.com",
                "Content-Type": "application/json",
                "Referer": process.env.YUNEXPRESS_REFERER!
            },
            body: JSON.stringify(<TrackQueryRequest>{
                NumberList: ids,
                CaptchaVerification: "",
                Year: 0,
                Timestamp: timestamp,
                Signature: signature
            })
        })

        if (!response.ok) {
            throw new Error(
                `[YunExpress Error] Failed to fetch! Status Code: ${response.status}, ${response.statusText}`,
            );
        }

        const data = (await response.json()) as TrackQueryResponse;
        const cacheFile = Bun.file("cache/yunExpress.json");
        let cacheFileData = {
            lastRun: Date.now(),
            result: data
        }
        if (await cacheFile.exists()) {
            const cacheData = await cacheFile.json();
            for (const item of data.ResultList as ResultListItem[]) {
                const lastTrack = item.TrackInfo.LastTrackEvent;
                const cachedItem = (cacheData.result!.ResultList as ResultListItem[]).find(i => i.Id === item.Id);
                if (cachedItem) {
                    const cachedLastTrack = cachedItem.TrackInfo.LastTrackEvent;
                    const fieldsToCompare: (keyof typeof lastTrack)[] = [
                        "ProcessContent",
                    ];

                    let isDifferent = false;
                    for (const field of fieldsToCompare) {
                        if (lastTrack[field] !== cachedLastTrack[field]) {
                            isDifferent = true;
                        }
                    }

                    if (item.TrackInfo.TransportStage !== cachedItem.TrackInfo.TransportStage) {
                        const stageText = {
                            PU: "Pickup",
                            DO: "Departed from origin",
                            AD: "Arrived at destination",
                            LC: "Local carrier on the way",
                            DD: "Delivered successfully",
                        } as const;

                        await app.client.chat.postMessage({
                            channel: String(process.env.CHANNEL),
                            text: `Item ending in ${item.Id.slice(-4)} has changed from ${stageText[cachedItem.TrackInfo.TransportStage] ?? "Unknown"} to ${stageText[item.TrackInfo.TransportStage] ?? "Unknown stage"}`,
                        });
                    } else if (isDifferent) {
                        const res = await app.client.chat.postMessage({
                            channel: String(process.env.CHANNEL),
                            text: `Update on item ending in ${item.Id.slice(-4)}, ProcessContent changed to ${item.TrackInfo.LastTrackEvent.ProcessContent}`,
                        });
                        if (!res.ok) {
                            console.error(res.error || res.errors)
                        }
                    }
                }
            }

            cacheFile.write(JSON.stringify(cacheFileData, null, 2))
            return;
        } else {
            cacheFile.write(JSON.stringify(cacheFileData, null, 2))
            return;
        }
    }

    const lastRun = await getLastRun();
    const now = Date.now();

    if (lastRun && now - lastRun < (Number(process.env.INTERVAL) || 15) * 60 * 1000) {
        const waitTime = (Number(process.env.INTERVAL) || 15) * 60 * 1000 - (now - lastRun);
        console.log(`[YunExpress] Last check was less than 10 minutes ago. Waiting ${Math.ceil(waitTime / 1000)}s.`);
        setTimeout(grabPackageDataAndPost, waitTime);
    } else {
        grabPackageDataAndPost();
        setInterval(grabPackageDataAndPost, (Number(process.env.INTERVAL) || 15) * 60 * 1000);
    }
}
