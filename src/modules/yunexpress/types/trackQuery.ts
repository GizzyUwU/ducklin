export type TrackQueryRequest = {
    NumberList: string[],
    CaptchaVerification: string,
    Year: number,
    Timestamp: number;
    Signature: string
}

export type TrackingEventDetailsItem =  {
    ProcessLocation: string;
    CreatedOn: string;
    ProcessContent: string;
}

export type ResultListItem = {
    Id: string;
    Status: number;
    TrackInfo: {
        WaybillNumber: string;
        TrackingNumber: string;
        CustomerOrderNumber: string;
        ChannelCodeIn: string;
        ChannelEnNameIn: string;
        AdditionalNotes: string;
        DestinationCountryCode: string;
        OriginCountryCode: string;
        Weight: number;
        TrackingStatus: number;
        IntervalDays: number;
        IntervalWorkdays: number;
        LastTrackEvent: {
            ProcessDate: string;
            ProcessContent: string;
            ProcessLocation: string;
            ProcessCity: string;
            TrackingStatus: number;
            CreatedOn: string;
            FlowType: number;
            Comments: string | string[] | null;
            IsPod: boolean;
            latitude: string;
            longitude: string;
            marks: string | string[] | boolean | null;
            ProcessContentOrg: string;
            returnTrackingNumber: string;
        }
        CreatedOn: string;
        TrackingEventDetails: TrackingEventDetailsItem[];
        IsServerPickup: boolean;
        CreatedOnTimezone: string;
        EndServiceCode: string;
        IsPod: boolean;
        IsSignature: boolean;
        ltsDigest: string;
        TransportStage: string;
    };
    TrackNotification: [Record<string, any>]
    ResendTrackList: [Record<string, any>]
}

export type TrackQueryResponse = {
    ResultList: ResultListItem[];
}