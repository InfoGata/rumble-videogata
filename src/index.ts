import { VideoObject, WithContext } from "schema-dts";
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

// Rumble has two kinds of channel page, /c/{name} and /user/{name}, and each
// 404s for the other kind's names. A channel's apiId is the bare name for /c/,
// which keeps ids saved before /user/ was handled working, and "user:{name}"
// for /user/.
const userPrefix = "user:";

const channelApiIdFromUrl = (href?: string | null): string | undefined => {
  if (!href) return undefined;
  const path = href
    .replace(/^https?:\/\/rumble\.com/, "")
    .split("?")[0]
    .replace(/\/$/, "");
  const [, kind, name] = path.split("/");
  if (!name) return undefined;
  return kind === "user" ? `${userPrefix}${name}` : name;
};

const channelPath = (apiId: string) =>
  apiId.startsWith(userPrefix)
    ? `/user/${apiId.substring(userPrefix.length)}`
    : `/c/${apiId}`;

function sendMessage(message: MessageType) {
  application.postUiMessage(message);
}

async function getVideoId(apiId: string): Promise<string> {
  const video = await getVideoById(apiId);
  return video.apiId || "";
}

const requestUrl = async (url: string): Promise<Response> => {
  let proxy = await application.getCorsProxy();
  if (!proxy) {
    proxy = "https://cloudcors.audio-pwa.workers.dev?url=";
  }

  const result = (await application.isNetworkRequestCorsDisabled())
    ? await application.networkRequest(url)
    : await fetch(`${proxy}${url}`);
  return result;
};

const getVideoById = async (apiId: string) => {
  const url = `${rumbleUrl}/${apiId}`;
  const result = await requestUrl(url);
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
  const channelApiId = channelApiIdFromUrl(link.getAttribute("href"));

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

const getChannelPage = async (apiId: string, page: number) => {
  let result = await requestUrl(`${rumbleUrl}${channelPath(apiId)}?page=${page}`);
  // A bare name saved before /user/ channels got their prefix may be one.
  if (result.status === 404 && !apiId.startsWith(userPrefix)) {
    result = await requestUrl(`${rumbleUrl}/user/${apiId}?page=${page}`);
  }
  const text = await result.text();
  return new DOMParser().parseFromString(text, "text/html");
};

const getChannelVideos = async (
  request: ChannelVideosRequest
): Promise<ChannelVideosResult> => {
  // Pages hold 24 videos on page one and 20 after, so offset is only used as
  // a page counter: VideoGata steps it by resultsPerPage.
  const perPage = 20;
  const offset = request.pageInfo?.offset || 0;
  const page = offset / perPage + 1;
  const apiId = request.apiId || "";
  const html = await getChannelPage(apiId, page);

  // The video grid is drawn client-side from JSON the page embeds, one
  // script per shelf (the first page has a "latest" shelf above the grid).
  const seen = new Set<number>();
  const listed: JsonVideo[] = [];
  html.querySelectorAll('script[type="application/json"]').forEach((s) => {
    try {
      const data = JSON.parse(s.textContent || "");
      if (Array.isArray(data?.items)) listed.push(...data.items);
    } catch {
      // Not every JSON script on the page is a shelf.
    }
  });
  const items = listed
    .filter((v) => {
      if (v.object_type !== "video" || seen.has(v.id)) return false;
      seen.add(v.id);
      return true;
    })
    .map(jsonVideoToVideo);

  const name = html.querySelector("h1")?.textContent?.trim();
  const thumb = listed.find((v) => v.by?.thumb)?.by?.thumb;
  const hasNext = !!html.querySelector('link[rel="next"]');

  return {
    items,
    channel: name
      ? { name, apiId, images: thumb ? [{ url: thumb }] : undefined }
      : undefined,
    pageInfo: {
      resultsPerPage: perPage,
      offset,
      nextPage: hasNext ? (page + 1).toString() : undefined,
    },
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
  const apiId = link?.getAttribute("href")?.substring(1).split("?")[0];

  // Channel name
  const channelLink = listing.getElementsByClassName(
    "video-item--by-a"
  )[0] as HTMLAnchorElement;
  const channelName = channelLink?.textContent || "";
  const channelApiId = channelApiIdFromUrl(channelLink?.getAttribute("href"));

  return {
    title,
    duration,
    apiId,
    channelName,
    channelApiId,
    images: [{ url: imageSrc }],
  };
};

// Each result is an <article> whose avatar is an <i> with a numbered class;
// the image itself is set by a rule for that class in the page's <style>.
const channelListingToChannel = (
  listing: Element,
  avatars: Map<string, string>
): Channel | undefined => {
  const link = listing.querySelector('a[href^="/c/"], a[href^="/user/"]');
  const apiId = channelApiIdFromUrl(link?.getAttribute("href"));
  if (!apiId) return undefined;

  const name =
    listing.querySelector("h3 .truncate")?.textContent?.trim() ||
    listing.querySelector("h3")?.textContent?.trim() ||
    "";
  const avatarId = listing
    .querySelector("i.user-image")
    ?.className.match(/user-image--img--id-(\d+)/)?.[1];
  const avatar = avatarId ? avatars.get(avatarId) : undefined;

  return {
    name,
    images: avatar ? [{ url: avatar }] : [],
    apiId,
  };
};

const searchVideos = async (
  request: SearchRequest
): Promise<SearchVideoResult> => {
  const perPage = 20;
  const offset = request.pageInfo?.offset || 0;
  const page = offset / perPage + 1;
  const query = encodeURIComponent(request.query);
  const url = `${rumbleUrl}/search/videos?q=${query}&page=${page}`;
  const result = await requestUrl(url);

  const text = await result.text();
  const parser = new DOMParser();
  const html = parser.parseFromString(text, "text/html");
  const listings = Array.from(
    html.getElementsByClassName("video-listing-entry")
  );
  const items: Video[] = listings.map(videoListingToVideo);
  const hasNext = !!html.querySelector('link[rel="next"]');
  // Pages hold 25 videos; offset is only used as a page counter.
  const pageInfo: PageInfo = {
    resultsPerPage: perPage,
    offset,
    nextPage: hasNext ? (page + 1).toString() : undefined,
  };
  return {
    items,
    pageInfo,
  };
};

const searchChannels = async (
  request: SearchRequest
): Promise<SearchChannelResult> => {
  // Pages hold about 40 channels; offset is only used as a page counter.
  const perPage = 20;
  const offset = request.pageInfo?.offset || 0;
  const page = offset / perPage + 1;
  const query = encodeURIComponent(request.query);
  const url = `${rumbleUrl}/search/channel?q=${query}&page=${page}`;

  const result = await requestUrl(url);
  const text = await result.text();
  const html = new DOMParser().parseFromString(text, "text/html");

  const avatars = new Map<string, string>();
  const avatarRule =
    /i\.user-image--img--id-(\d+)\s*\{\s*background-image:\s*url\(["']?([^"')]+)/g;
  html.querySelectorAll("style").forEach((style) => {
    const css = style.textContent || "";
    let m: RegExpExecArray | null;
    while ((m = avatarRule.exec(css))) avatars.set(m[1], m[2]);
  });

  const items = Array.from(html.querySelectorAll("article"))
    .map((a) => channelListingToChannel(a, avatars))
    .filter((c): c is Channel => !!c);

  // No <link rel="next"> here, only numbered page links.
  const hasNext = !!html.querySelector(
    `a[href*="page=${page + 1}"][href^="/search/channel"]`
  );

  return {
    items,
    pageInfo: {
      resultsPerPage: perPage,
      offset,
      nextPage: hasNext ? (page + 1).toString() : undefined,
    },
  };
};

// The shape Rumble's own pages are drawn from: the homepage API returns these,
// and channel pages embed them as JSON.
interface JsonVideo {
  object_type: string;
  id: number;
  title: string;
  duration?: number;
  thumb?: string;
  upload_date?: string;
  relative_url: string;
  url?: string;
  views?: number;
  is_short?: boolean;
  by?: {
    relative_url?: string;
    name?: string;
    thumb?: string;
  };
}

const jsonVideoToVideo = (v: JsonVideo): Video => {
  const video: Video & { channelImages?: ImageInfo[] } = {
    title: v.title,
    // Same form as the listings' hrefs: the path without its leading slash.
    apiId: v.relative_url.substring(1),
    // 0 for a stream still in progress, as on the site's own cards.
    duration: v.duration ?? 0,
    channelName: v.by?.name,
    channelApiId: channelApiIdFromUrl(v.by?.relative_url),
    images: v.thumb ? [{ url: v.thumb }] : undefined,
    uploadDate: v.upload_date,
    originalUrl: v.url,
    views: v.views,
    channelImages: v.by?.thumb ? [{ url: v.by.thumb }] : undefined,
  };
  return video;
};

interface HomepageLayout {
  data?: {
    sections?: { kind: string; items?: JsonVideo[] }[];
  };
}

// The front page is rendered client-side: its HTML has no video listings, and
// the sections come from this endpoint. "three_or_four" is the stack the site
// itself asks for on a desktop-sized window.
const getHomepageVideos = async (): Promise<JsonVideo[]> => {
  const url = `${rumbleUrl}/-api/homepage/layout?stack=three_or_four`;
  const result = await requestUrl(url);
  const layout: HomepageLayout = await result.json();

  const listed: JsonVideo[] = [];
  for (const section of layout.data?.sections ?? []) {
    // Shorts, live categories, banners and ads are their own section kinds.
    if (section.kind === "mixed_content") listed.push(...(section.items ?? []));
  }
  return listed;
};

const getTopItems = async (): Promise<SearchAllResult> => {
  // About one response in eight has every section's items left empty; the
  // site's own page just asks again, and so does this.
  let listed: JsonVideo[] = [];
  for (let attempt = 0; attempt < 3 && listed.length === 0; attempt++) {
    listed = await getHomepageVideos();
  }

  const seen = new Set<number>();
  const items = listed
    .filter((v) => {
      if (v.object_type !== "video" || v.is_short || seen.has(v.id)) {
        return false;
      }
      seen.add(v.id);
      return true;
    })
    .map(jsonVideoToVideo);

  return { videos: { items } };
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
application.onGetTopItems = getTopItems;

const init = () => {};

init();
