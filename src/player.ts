import { MessageType, UiMessageType } from "./types";

declare global {
  var Rumble: any;
}

const playVideo = (videoId: string) => {
  Rumble("play", {
    video: videoId,
    div: "player",
    api: function (api: any) {
      const videoElement: HTMLVideoElement =
        document.getElementsByTagName("video")[0];
      api.on("videoEnd", () => {
        sendMessage({ type: "endvideo" });
      });
      videoElement.play();
    },
  });
};

const sendMessage = (message: UiMessageType) => {
  parent.postMessage(message, "*");
};

export const init = () => {
  const params = new URLSearchParams(window.location.search);

  // Retrieve video info
  const apiId = params.get("apiId");
  if (apiId) {
    sendMessage({ type: "geturl", apiId });
  }

  const onMessage = (event: MessageEvent<MessageType>) => {
    switch (event.data.type) {
      case "videoid":
        playVideo(event.data.videoId);
        break;
    }
  };
  window.addEventListener("message", onMessage);
};
