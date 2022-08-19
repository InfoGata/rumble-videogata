import "videogata-plugin-typings";
import { MessageType, UiMessageType } from "./types";

const rumbleUrl = "https://rumble.com";

function hmsToSecondsOnly(str: string) {
  var p = str.split(":"),
    s = 0,
    m = 1;

  while (p.length > 0) {
    s += m * parseInt(p.pop() || "0", 10);
    m *= 60;
  }

  return s;
}

function sendMessage(message: MessageType) {
  application.postUiMessage(message);
}

async function getVideoId(apiId: string): Promise<string> {
  const url = `${rumbleUrl}/${apiId}`;
  let proxy = await application.getCorsProxy();
  if (!proxy) {
    proxy = "https://cloudcors.audio-pwa.workers.dev?url=";
  }

  const result = await fetch(`${proxy}${url}`);
  const text = await result.text();
  const parser = new DOMParser();
  const html = parser.parseFromString(text, "text/html");

  const jsonNode = html.querySelector('script[type="application/ld+json"]');
  const jsonLd: any[] = JSON.parse(jsonNode?.textContent || "");
  const videoObject = jsonLd.filter((j) => j["@type"] === "VideoObject")[0];

  // https://rumble.com/embed/{videoId}/
  const embedUrl: string = videoObject.embedUrl;
  const videoId = embedUrl.split("/").slice(0, -1).slice(-1)[0];

  return videoId;
}

application.onUiMessage = async (message: UiMessageType) => {
  switch (message.type) {
    case "geturl":
      const videoId = await getVideoId(message.apiId);
      sendMessage({ type: "videoid", videoId: videoId });
      break;
    case "endvideo":
      application.endVideo();
      break;
  }
};

const videoListingToVideo = (listing: Element): Video => {
  // title
  const title =
    listing.getElementsByClassName("video-item--title")[0].textContent || "";

  //duration
  const durationElement = listing.getElementsByClassName(
    "video-item--duration"
  )[0];
  const timeStr = durationElement.getAttribute("data-value");
  const duration = hmsToSecondsOnly(timeStr || "0");

  //images
  const imgElement = listing.getElementsByClassName(
    "video-item--img"
  )[0] as HTMLImageElement;
  const imageSrc = imgElement.src;

  // apiId
  const link = listing.getElementsByClassName(
    "video-item--a"
  )[0] as HTMLAnchorElement;
  const apiId = link.getAttribute("href")?.substring(1).split("0")[0];

  return {
    title,
    duration,
    apiId,
    images: [{ url: imageSrc }],
  };
};

const searchVideos = async (
  request: SearchRequest
): Promise<SearchVideoResult> => {
  const url = `${rumbleUrl}/search/videos`;
  const urlWithQuery = `${url}?q=${request.query}`;
  let proxy = await application.getCorsProxy();
  if (!proxy) {
    proxy = "https://cloudcors.audio-pwa.workers.dev?url=";
  }
  const result = await fetch(`${proxy}${urlWithQuery}`);

  const text = await result.text();
  const parser = new DOMParser();
  const html = parser.parseFromString(text, "text/html");
  const listings = Array.from(
    html.getElementsByClassName("video-listing-entry")
  );
  const items: Video[] = listings.map(videoListingToVideo);
  return {
    items,
  };
};

const searchAll = async (request: SearchRequest): Promise<SearchAllResult> => {
  const videosPromise = searchVideos(request);
  const [videos] = await Promise.all([videosPromise]);
  return { videos };
};

application.onSearchAll = searchAll;
application.onSearchVideos = searchVideos;

const init = () => {};

init();
