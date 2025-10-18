export type SleepSessionItem = {
    _id: string;
    app: string;
    data: {
        notes: string;
        stages: { stage: number; startTime: string; endTime: string }[];
        title: string;
    }
    end: string;
    id: string;
    start: string;
}

export type SleepSessionResponse = SleepSessionItem[]
