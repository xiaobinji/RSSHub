import { baseUrl, gqlMap, gqlFeatures } from './constants';
import { config } from '@/config';
import cache from '@/utils/cache';
import logger from '@/utils/logger';
import { twitterGot, paginationTweets, gatherLegacyFromData } from './utils';
import InvalidParameterError from '@/errors/types/invalid-parameter';
import ofetch from '@/utils/ofetch';

const getUserData = (id) =>
    cache.tryGet(`twitter-userdata-${id}`, () => {
        const params = {
            variables: id.startsWith('+')
                ? JSON.stringify({
                      userId: id.slice(1),
                      withSafetyModeUserFields: true,
                  })
                : JSON.stringify({
                      screen_name: id,
                      withSafetyModeUserFields: true,
                  }),
            features: JSON.stringify(id.startsWith('+') ? gqlFeatures.UserByRestId : gqlFeatures.UserByScreenName),
            fieldToggles: JSON.stringify({
                withAuxiliaryUserLabels: false,
            }),
        };

        if (config.twitter.thirdPartyApi) {
            const endpoint = id.startsWith('+') ? gqlMap.UserByRestId : gqlMap.UserByScreenName;

            return ofetch(`${config.twitter.thirdPartyApi}${endpoint}`, {
                method: 'GET',
                params,
                headers: {
                    'accept-encoding': 'gzip',
                },
            });
        }

        return twitterGot(`${baseUrl}${id.startsWith('+') ? gqlMap.UserByRestId : gqlMap.UserByScreenName}`, params, {
            allowNoAuth: !id.startsWith('+'),
        });
    });

const cacheTryGet = async (_id, params, func) => {
    const userData: any = await getUserData(_id);
    const id = (userData.data?.user || userData.data?.user_result)?.result?.rest_id;
    if (id === undefined) {
        cache.set(`twitter-userdata-${_id}`, '', config.cache.contentExpire);
        throw new InvalidParameterError('User not found');
    }
    const funcName = func.name;
    const paramsString = JSON.stringify(params);
    return cache.tryGet(`twitter:${id}:${funcName}:${paramsString}`, () => func(id, params), config.cache.routeExpire, false);
};

const _getUserTweets = (id: string, params?: Record<string, any>) =>
    cacheTryGet(id, params, async (id, params = {}) =>
        gatherLegacyFromData(
            await paginationTweets('UserTweets', id, {
                ...params,
                count: 20,
                includePromotedContent: true,
                withQuickPromoteEligibilityTweetFields: true,
                withVoice: true,
                withV2Timeline: true,
            })
        )
    );

const getUserTweets = async (id: string, params?: Record<string, any>) => {
    let tweets: any[] = [];
    const rest_id = (await getUserData(id)).data?.user?.result?.rest_id || (await getUserData(id)).data?.user_result?.result?.rest_id;

    // Fetch from multiple sources like mobile-api does
    await Promise.all(
        [_getUserTweets, getUserMedia].map(async (func) => {
            try {
                const result = await func(id, params);
                if (result) {
                    tweets.push(...result);
                }
            } catch (error) {
                logger.warn(`Failed to get tweets for ${id} with ${func.name}: ${error}`);
            }
        })
    );

    // Try getUserTweetsAndReplies but don't fail if it errors (404)
    try {
        const repliesResult = await getUserTweetsAndReplies(id, params);
        if (repliesResult) {
            tweets.push(...repliesResult);
        }
    } catch (error) {
        logger.warn(`getUserTweetsAndReplies failed (possibly deprecated endpoint): ${error instanceof Error ? error.message : error}`);
    }

    const cacheKey = `twitter:user:tweets-cache:${rest_id}`;
    let cacheValue = await cache.get(cacheKey);
    if (cacheValue) {
        try {
            cacheValue = JSON.parse(cacheValue);
            if (cacheValue && Array.isArray(cacheValue) && cacheValue.length) {
                tweets = [...cacheValue, ...tweets];
            }
        } catch {
            // Ignore cache parse errors
        }
    }

    // Deduplicate and filter
    const idSet = new Set();
    tweets = tweets
        .filter(
            (tweet) =>
                !tweet.in_reply_to_user_id_str || // exclude replies to others
                tweet.in_reply_to_user_id_str === rest_id // include replies to self (threads)
        )
        .filter((tweet) => tweet?.id_str) // ensure tweet has valid id_str
        .map((tweet) => {
            if (!idSet.has(tweet.id_str)) {
                idSet.add(tweet.id_str);
                return tweet;
            }
            return null;
        })
        .filter(Boolean) // remove nulls
        .sort((a: any, b: any) => {
            // Use BigInt for safe comparison of Twitter IDs (64-bit integers)
            const aId = BigInt(a.id_str || a.conversation_id_str || '0');
            const bId = BigInt(b.id_str || b.conversation_id_str || '0');
            return bId > aId ? 1 : bId < aId ? -1 : 0;
        }) // sort descending
        .slice(0, 20);

    cache.set(cacheKey, JSON.stringify(tweets));
    return tweets;
};

const getUserTweetsAndReplies = (id: string, params?: Record<string, any>) =>
    cacheTryGet(id, params, async (id, params = {}) =>
        gatherLegacyFromData(
            await paginationTweets('UserTweetsAndReplies', id, {
                ...params,
                count: 20,
                includePromotedContent: true,
                withCommunity: true,
                withVoice: true,
                withV2Timeline: true,
            }),
            ['profile-conversation-'],
            id
        )
    );

const getUserMedia = (id: string, params?: Record<string, any>) =>
    cacheTryGet(id, params, async (id, params = {}) => {
        const cursorSource = await paginationTweets('UserMedia', id, {
            ...params,
            count: 20,
            includePromotedContent: false,
            withClientEventToken: false,
            withBirdwatchNotes: false,
            withVoice: true,
            withV2Timeline: true,
        });
        const cursor = cursorSource.find((i) => i.content?.cursorType === 'Top').content.value;
        return gatherLegacyFromData(
            await paginationTweets('UserMedia', id, {
                ...params,
                cursor,
                count: 20,
                includePromotedContent: false,
                withClientEventToken: false,
                withBirdwatchNotes: false,
                withVoice: true,
                withV2Timeline: true,
            })
        );
    });

const getUserLikes = (id: string, params?: Record<string, any>) =>
    cacheTryGet(id, params, async (id, params = {}) =>
        gatherLegacyFromData(
            await paginationTweets('Likes', id, {
                ...params,
                includeHasBirdwatchNotes: false,
                includePromotedContent: false,
                withBirdwatchNotes: false,
                withVoice: false,
                withV2Timeline: true,
            })
        )
    );

const getUserTweet = (id: string, params?: Record<string, any>) =>
    cacheTryGet(id, params, async (id, params = {}) =>
        gatherLegacyFromData(
            await paginationTweets(
                'TweetDetail',
                id,
                {
                    ...params,
                    includeHasBirdwatchNotes: false,
                    includePromotedContent: false,
                    withBirdwatchNotes: false,
                    withVoice: false,
                    withV2Timeline: true,
                },
                ['threaded_conversation_with_injections_v2']
            ),
            ['homeConversation-', 'conversationthread-']
        )
    );

const getSearch = async (keywords: string, params?: Record<string, any>) =>
    gatherLegacyFromData(
        await paginationTweets(
            'SearchTimeline',
            undefined,
            {
                ...params,
                rawQuery: keywords,
                count: 20,
                querySource: 'typed_query',
                product: 'Latest',
            },
            ['search_by_raw_query', 'search_timeline', 'timeline']
        )
    );

const getList = async (id: string, params?: Record<string, any>) =>
    gatherLegacyFromData(
        await paginationTweets(
            'ListLatestTweetsTimeline',
            undefined,
            {
                ...params,
                listId: id,
                count: 20,
            },
            ['list', 'tweets_timeline', 'timeline']
        )
    );

const getUser = async (id: string) => {
    const userData: any = await getUserData(id);
    return {
        profile_image_url: userData.data?.user?.result?.avatar?.image_url,
        ...userData.data?.user?.result?.core,
        ...(userData.data?.user || userData.data?.user_result)?.result?.legacy,
    };
};

const getHomeTimeline = async (id: string, params?: Record<string, any>) =>
    gatherLegacyFromData(
        await paginationTweets(
            'HomeTimeline',
            undefined,
            {
                ...params,
                count: 20,
                includePromotedContent: true,
                latestControlAvailable: true,
                requestContext: 'launch',
                withCommunity: true,
            },
            ['home', 'home_timeline_urt']
        )
    );

const getHomeLatestTimeline = async (id: string, params?: Record<string, any>) =>
    gatherLegacyFromData(
        await paginationTweets(
            'HomeLatestTimeline',
            undefined,
            {
                ...params,
                count: 20,
                includePromotedContent: true,
                latestControlAvailable: true,
                requestContext: 'launch',
                withCommunity: true,
            },
            ['home', 'home_timeline_urt']
        )
    );

export default {
    getUser,
    getUserTweets,
    getUserTweetsAndReplies,
    getUserMedia,
    getUserLikes,
    getUserTweet,
    getSearch,
    getList,
    getHomeTimeline,
    getHomeLatestTimeline,
    init: () => {},
};
