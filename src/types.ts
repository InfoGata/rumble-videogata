type UiGetUrlType = {
  type: "geturl";
  apiId: string;
};

type UiEndVideoType = {
  type: "endvideo";
};

export type UiMessageType = UiGetUrlType | UiEndVideoType;

type VideoIdType = {
  type: "videoid";
  videoId: string;
};

export type MessageType = VideoIdType;
