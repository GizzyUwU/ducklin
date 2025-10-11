import type { FetchRequest, FetchResponse } from "./types/fetch"
import { grabUser } from "./login";

export async function grabData(
    url: string,
    method: string,
    queries: Record<string, any> | null,
    token: string
): Promise<FetchResponse> {
    const fetchResponse = await Bun.fetch(url + "/fetch/" + method, {
        method: "POST",
        headers: {
            "Content-Type": "application/json",
            "Authorization": `Bearer ${token}`
        },
        body: JSON.stringify(<FetchRequest>{
            queries
        }),
    });

    if (!fetchResponse.ok) {
        throw new Error(
            `[HC_GATEWAY ERROR] Failed to fetch! Status Code: ${fetchResponse.status}, ${fetchResponse.statusText}`,
        );
    }

    const fetchData = (await fetchResponse.json()) as FetchResponse;
    return fetchData;
}
