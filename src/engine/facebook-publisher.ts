/**
 * facebook-publisher.ts — Direct Facebook Page publishing via Graph API v25.0
 * Bypasses Buffer entirely. Uses System User token with pages_manage_posts scope.
 *
 * Env vars required (Railway):
 *   FACEBOOK_PAGE_ACCESS_TOKEN — permanent system-user token
 *   FACEBOOK_PAGE_ID           — numeric Page ID (1064072003457963)
 */

const FB_API = "https://graph.facebook.com/v25.0";

interface FacebookPostResult {
  success: boolean;
  postId?: string;
  error?: string;
}

/**
 * Publish a text post (with optional link) to the Sovereign Synthesis Facebook Page.
 */
export async function publishToFacebook(
  text: string,
  options?: { link?: string; imageUrl?: string }
): Promise<FacebookPostResult> {
  const token = process.env.FACEBOOK_PAGE_ACCESS_TOKEN;
  const pageId = process.env.FACEBOOK_PAGE_ID;

  if (!token || !pageId) {
    return {
      success: false,
      error: "FACEBOOK_PAGE_ACCESS_TOKEN or FACEBOOK_PAGE_ID not set",
    };
  }

  try {
    // If there's an image, use /photos endpoint; otherwise /feed
    if (options?.imageUrl) {
      return await postPhoto(pageId, token, text, options.imageUrl);
    }

    const body: Record<string, string> = {
      message: text,
      access_token: token,
    };

    if (options?.link) {
      body.link = options.link;
    }

    const res = await fetch(`${FB_API}/${pageId}/feed`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });

    const data = await res.json();

    if (data.id) {
      console.log(`✅ [FacebookPublisher] Posted: ${data.id}`);
      return { success: true, postId: data.id };
    }

    const errMsg = data.error?.message || JSON.stringify(data);
    console.error(`❌ [FacebookPublisher] API error: ${errMsg}`);
    return { success: false, error: errMsg };
  } catch (err: any) {
    console.error(`❌ [FacebookPublisher] Network error: ${err.message}`);
    return { success: false, error: err.message };
  }
}

/**
 * Post a photo with caption to the Page.
 */
async function postPhoto(
  pageId: string,
  token: string,
  caption: string,
  imageUrl: string
): Promise<FacebookPostResult> {
  const body = {
    url: imageUrl,
    message: caption,
    access_token: token,
  };

  const res = await fetch(`${FB_API}/${pageId}/photos`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

  const data = await res.json();

  if (data.id || data.post_id) {
    const id = data.post_id || data.id;
    console.log(`✅ [FacebookPublisher] Photo posted: ${id}`);
    return { success: true, postId: id };
  }

  const errMsg = data.error?.message || JSON.stringify(data);
  console.error(`❌ [FacebookPublisher] Photo API error: ${errMsg}`);
  return { success: false, error: errMsg };
}
