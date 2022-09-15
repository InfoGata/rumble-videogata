import { VideoObject, WithContext } from "schema-dts";
import "videogata-plugin-typings";
import { MessageType, UiMessageType } from "./types";
import { parse, toSeconds } from "iso8601-duration";

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
  const video = await getVideoById(apiId);
  return video.apiId || "";
}

const getVideoById = async (apiId: string) => {
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
  const videoObject: WithContext<VideoObject> = jsonLd.filter(
    (j) => j["@type"] === "VideoObject"
  )[0];

  // https://rumble.com/embed/{videoId}/
  const embedUrl: string = videoObject.embedUrl?.toString() || "";
  const videoId = embedUrl.split("/").slice(0, -1).slice(-1)[0];
  const uploadDate = videoObject.uploadDate?.toString();
  const name = videoObject.name?.toString();
  const durationStr = videoObject.duration?.toString();
  let duration = 0;
  if (durationStr) {
    duration = toSeconds(parse(durationStr));
  }
  const originalUrl = videoObject.url?.toString();
  const thumbnailUrl = videoObject.thumbnailUrl?.toString();
  let views: number | undefined;
  if (
    videoObject.interactionStatistic &&
    "userInteractionCount" in videoObject.interactionStatistic
  ) {
    views =
      videoObject.interactionStatistic.userInteractionCount?.valueOf() as any;
  }

  const channelName =
    html.getElementsByClassName("media-heading-name")[0].textContent || "";

  const link = html.getElementsByClassName(
    "media-by--a"
  )[0] as HTMLAnchorElement;
  const channelApiId = link.getAttribute("href")?.split("/").slice(-1)[0];

  const video: Video = {
    title: name || "",
    channelName: channelName,
    channelApiId,
    duration,
    apiId: videoId,
    uploadDate,
    images: thumbnailUrl
      ? [
          {
            url: thumbnailUrl,
          },
        ]
      : undefined,
    originalUrl,
    views,
  };
  return video;
};

const getChannelVideos = async (request: ChannelVideosRequest) => {
  const url = `${rumbleUrl}/c/${request.apiId}`;
  let proxy = await application.getCorsProxy();
  if (!proxy) {
    proxy = "https://cloudcors.audio-pwa.workers.dev?url=";
  }

  const result = await fetch(`${proxy}${url}`);
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

const getVideo = async (request: GetVideoRequest) => {
  return await getVideoById(request.apiId);
};

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
    listing.getElementsByClassName("video-item--title")[0]?.textContent || "";

  //duration
  const durationElement = listing.getElementsByClassName(
    "video-item--duration"
  )[0];
  const timeStr = durationElement?.getAttribute("data-value");
  const duration = hmsToSecondsOnly(timeStr || "0");

  //images
  const imgElement = listing.getElementsByClassName(
    "video-item--img"
  )[0] as HTMLImageElement;
  const imageSrc = imgElement?.src;

  // apiId
  const link = listing.getElementsByClassName(
    "video-item--a"
  )[0] as HTMLAnchorElement;
  const apiId = link?.getAttribute("href")?.substring(1).split("0")[0];

  return {
    title,
    duration,
    apiId,
    images: [{ url: imageSrc }],
  };
};

const channelListingToChannel = (
  listing: Element,
  index: number,
  styles: Record<string, CSSStyleDeclaration>
): Channel => {
  // title
  const title =
    listing.getElementsByClassName("channel-item--title")[0]?.textContent || "";

  // apiId
  const link = listing.getElementsByClassName(
    "channel-item--a"
  )[0] as HTMLAnchorElement;
  const apiId = link.getAttribute("href")?.split("/").slice(-1)[0];

  //images
  const iElement = listing.getElementsByClassName(
    "user-image--img"
  )[0] as HTMLImageElement;

  const selector = `i.user-image--img--id-${index}`;
  const rule = styles[selector];
  let backgroundImage: string | undefined;
  if (rule) {
    backgroundImage = rule.backgroundImage.slice(4, -1).replace(/"/g, "");
  }

  return {
    name: title,
    images: backgroundImage ? [{ url: backgroundImage }] : [],
    apiId,
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

const searchChannels = async (request: SearchRequest) => {
  const url = `${rumbleUrl}/search/channel`;
  const urlWithQuery = `${url}?q=${request.query}`;
  let proxy = await application.getCorsProxy();
  if (!proxy) {
    proxy = "https://cloudcors.audio-pwa.workers.dev?url=";
  }
  const result = await fetch(`${proxy}${urlWithQuery}`);
  const text = await result.text();
  const parser = new DOMParser();
  const html = parser.parseFromString(text, "text/html");

  // create index of styles
  const listings = Array.from(
    html.getElementsByClassName("video-listing-entry")
  );

  // create index of styles
  const rules = html.styleSheets[0].cssRules;
  const styles = Array.from(rules)
    .filter((r) => r instanceof CSSStyleRule)
    .reduce<Record<string, CSSStyleDeclaration>>((a, r) => {
      const styleRule = r as CSSStyleRule;
      a[styleRule.selectorText] = styleRule.style;
      return a;
    }, {});

  const items: Channel[] = listings.map((l, i) =>
    channelListingToChannel(l, i, styles)
  );
  return {
    items,
  };
};

const searchAll = async (request: SearchRequest): Promise<SearchAllResult> => {
  const videosPromise = searchVideos(request);
  const channelsPromise = searchChannels(request);
  const [videos, channels] = await Promise.all([
    videosPromise,
    channelsPromise,
  ]);
  return { videos, channels };
};

application.onSearchAll = searchAll;
application.onSearchVideos = searchVideos;
application.onGetVideo = getVideo;
application.onGetChannelVideos = getChannelVideos;
application.onSearchChannels = searchChannels;

const init = () => {};

init();
