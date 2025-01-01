/* eslint-disable @typescript-eslint/no-explicit-any */
/* eslint-disable @typescript-eslint/ban-ts-comment */
import {
    ContentRating,
    DUIForm,
    PagedResults,
    SearchRequest,
    DUISection,
    SourceInfo,
    Request,
    Response,
    TrackerActionQueue,
    Searchable,
    MangaProgressProviding,
    SourceManga,
    MangaProgress,
    SourceIntents,
} from '@paperback/types'

import {
    deleteMangaProgressMutation,
    getMangaProgressQuery,
    getMangaQuery,
    GraphQLQuery,
    saveMangaProgressMutation,
    SaveMangaProgressVariables,
    searchMangaQuery,
    userProfileQuery
} from './models/graphql-queries'

import * as AnilistUser from './models/anilist-user'
import * as AnilistPage from './models/anilist-page'
import * as AnilistManga from './models/anilist-manga'
import { AnilistResult } from './models/anilist-result'

import {
    getDefaultStatus,
    getDefaultPrivate,
    getDefaultHideFromStatusLists,
    trackerSettings
} from './AlSettings'

const ANILIST_GRAPHQL_ENDPOINT = 'https://graphql.anilist.co/'

export const AnilistInfo: SourceInfo = {
    name: 'Anilist',
    author: 'Faizan Durrani ♥ Netsky',
    contentRating: ContentRating.EVERYONE,
    icon: 'icon.png',
    version: '1.1.8',
    description: 'Modified Anilist Tracker',
    websiteBaseURL: 'https://anilist.co',
    intents: SourceIntents.MANGA_TRACKING | SourceIntents.SETTINGS_UI
}

export class Anilist implements Searchable, MangaProgressProviding {
    stateManager = App.createSourceStateManager();

    requestManager = App.createRequestManager({
        requestsPerSecond: 2.5,
        requestTimeout: 20_000,
        interceptor: {
            // Authorization injector
            interceptRequest: async (request: Request): Promise<Request> => {
                const accessToken = await this.accessToken.get()
                request.headers = {
                    ...(request.headers ?? {}),
                    ...({
                        'content-type': 'application/json',
                        'accept': 'application/json'
                    }),
                    ...(accessToken != null ? {
                        'authorization': `Bearer ${accessToken}`
                    } : {})
                }
                return request
            },
            interceptResponse: async (response: Response): Promise<Response> => {
                return response
            }
        }
    });

    accessToken = {
        get: async (): Promise<string | undefined> => {
            return this.stateManager.keychain.retrieve('access_token') as Promise<string | undefined>
        },
        set: async (token: string | undefined): Promise<void> => {
            await this.stateManager.keychain.store('access_token', token)
            await this.userInfo.refresh()
        },
        isValid: async (): Promise<boolean> => {
            return (await this.accessToken.get()) != null
        }
    };

    userInfo = {
        get: async (): Promise<AnilistUser.Viewer | undefined> => {
            return this.stateManager.retrieve('userInfo') as Promise<AnilistUser.Viewer | undefined>
        },
        isLoggedIn: async (): Promise<boolean> => {
            return (await this.userInfo.get()) != null
        },
        refresh: async (): Promise<void> => {
            const accessToken = await this.accessToken.get()
            if (accessToken == null) {
                return this.stateManager.store('userInfo', undefined)
            }
            const response = await this.requestManager.schedule(App.createRequest({
                url: ANILIST_GRAPHQL_ENDPOINT,
                method: 'POST',
                data: userProfileQuery()
            }), 0)
            const userInfo = AnilistResult<AnilistUser.Result>(response.data).data?.Viewer
            await this.stateManager.store('userInfo', userInfo)
        }
    };

    async getSearchResults(query: SearchRequest, metadata: unknown): Promise<PagedResults> {
        const pageInfo = metadata as AnilistPage.PageInfo | undefined
        // If there are no more results, we don't want to make extra calls to Anilist
        if (pageInfo?.hasNextPage === false) {
            return App.createPagedResults({ results: [], metadata: pageInfo })
        }

        const nextPage = (pageInfo?.currentPage ?? 0) + 1
        const response = await this.requestManager.schedule(App.createRequest({
            url: ANILIST_GRAPHQL_ENDPOINT,
            method: 'POST',
            data: searchMangaQuery(nextPage, query.title ?? '')
        }), 1)

        const anilistPage = AnilistResult<AnilistPage.Result>(response.data).data?.Page

        //console.log(JSON.stringify(anilistPage, null, 2)) // Log request data

        return App.createPagedResults({
            results: anilistPage?.media.map(manga => App.createPartialSourceManga({
                image: manga.coverImage.large ?? '',
                title: manga.title.userPreferred,
                mangaId: manga.id.toString(),
                subtitle: undefined
            })) ?? [],
            metadata: anilistPage?.pageInfo
        })
    }

    async getMangaProgress(mangaId: string): Promise<MangaProgress | undefined> {
        const response = await this.requestManager.schedule(App.createRequest({
            url: ANILIST_GRAPHQL_ENDPOINT,
            method: 'POST',
            data: getMangaProgressQuery(parseInt(mangaId))
        }), 1)

        const anilistManga = AnilistResult<AnilistManga.Result>(response.data).data?.Media

        if (!anilistManga?.mediaListEntry) { return undefined }

        return App.createMangaProgress({
            mangaId: mangaId,

            lastReadChapterNumber: anilistManga.mediaListEntry.progress ?? 0,
            lastReadVolumeNumber: anilistManga.mediaListEntry.progressVolumes,

            trackedListName: anilistManga.mediaListEntry.status,
            userRating: anilistManga.mediaListEntry.score
        })
    }

    async getMangaProgressManagementForm(mangaId: string): Promise<DUIForm> {
        const tempData: any = {} // Temp solution, app is ass

        return App.createDUIForm({
            sections: async () => {
                const [response] = await Promise.all([
                    this.requestManager.schedule(App.createRequest({
                        url: ANILIST_GRAPHQL_ENDPOINT,
                        method: 'POST',
                        data: getMangaProgressQuery(parseInt(mangaId))
                    }), 1),
                    this.userInfo.refresh()
                ])

                const anilistManga = AnilistResult<AnilistManga.Result>(response.data).data?.Media
                const user = await this.userInfo.get()
                if (user == null) {
                    return [
                        App.createDUISection({
                            id: 'notLoggedInSection',
                            isHidden: false,
                            rows: async () => [
                                App.createDUILabel({
                                    id: 'notLoggedIn',
                                    label: 'Not Logged In'
                                })
                            ]
                        })
                    ]
                }

                if (anilistManga == null) {
                    throw new Error(`Unable to find Manga on Anilist with id ${mangaId}`)
                }

                Object.assign(tempData, { id: anilistManga.mediaListEntry?.id, mediaId: anilistManga.id }) // Temp solution

                return [
                    App.createDUISection({
                        id: 'userInfo',
                        isHidden: false,
                        rows: async () => [
                            App.createDUIHeader({
                                id: 'header',
                                imageUrl: user.avatar?.large || '',
                                title: user.name ?? 'NOT LOGGED IN',
                                subtitle: ''
                            })
                        ]
                    }),
                    // Static items
                    App.createDUISection({
                        id: 'information',
                        header: 'Information',
                        isHidden: false,
                        rows: async () => [
                            // This allows us to get the id when the form is submitted
                            ...(anilistManga.mediaListEntry != null ? [App.createDUILabel({
                                id: 'id',
                                label: 'Entry ID',
                                value: anilistManga.mediaListEntry?.id?.toString()
                            })] : []),
                            App.createDUILabel({
                                id: 'mediaId',
                                label: 'Manga ID',
                                value: anilistManga.id?.toString()
                            }),
                            App.createDUILabel({
                                id: 'mangaTitle',
                                label: 'Title',
                                value: anilistManga.title?.userPreferred ?? 'N/A'
                            }),
                            App.createDUILabel({
                                id: 'mangaPopularity',
                                value: anilistManga.popularity?.toString() ?? 'N/A',
                                label: 'Popularity'
                            }),
                            App.createDUILabel({
                                id: 'mangaRating',
                                value: anilistManga.averageScore?.toString() ?? 'N/A',
                                label: 'Rating'
                            }),
                            App.createDUILabel({
                                id: 'mangaStatus',
                                value: this.formatStatus(anilistManga.status),
                                label: 'Status'
                            }),
                            App.createDUILabel({
                                id: 'mangaIsAdult',
                                value: anilistManga.isAdult ? 'Yes' : 'No',
                                label: 'Is Adult'
                            })
                        ]
                    }),
                    // User interactive items
                    // Status
                    App.createDUISection({
                        id: 'trackStatus',
                        header: 'Manga Status',
                        footer: 'Warning: Setting this to NONE will delete the listing from Anilist',
                        isHidden: false,
                        rows: async () => [
                            App.createDUISelect({
                                id: 'status',
                                //@ts-ignore
                                value: anilistManga.mediaListEntry?.status ? [anilistManga.mediaListEntry.status] : (await getDefaultStatus(this.stateManager)),
                                allowsMultiselect: false,
                                label: 'Status',
                                labelResolver: async (value) => {
                                    return this.formatStatus(value)
                                },
                                options: [
                                    'NONE',
                                    'CURRENT',
                                    'PLANNING',
                                    'COMPLETED',
                                    'DROPPED',
                                    'PAUSED',
                                    'REPEATING'
                                ]
                            })
                        ]
                    }),
                    // Progress
                    App.createDUISection({
                        id: 'manage',
                        header: 'Progress',
                        isHidden: false,
                        rows: async () => [
                            App.createDUIStepper({
                                id: 'progress',
                                label: 'Chapter',
                                //@ts-ignore
                                value: anilistManga.mediaListEntry?.progress ?? 0,
                                min: 0,
                                step: 1
                            }),
                            App.createDUIStepper({
                                id: 'progressVolumes',
                                label: 'Volume',
                                //@ts-ignore
                                value: anilistManga.mediaListEntry?.progressVolumes ?? 0,
                                min: 0,
                                step: 1
                            }),
                            App.createDUIStepper({
                                id: 'repeat',
                                label: 'Times Re-Read',
                                //@ts-ignore
                                value: anilistManga.mediaListEntry?.repeat != undefined ? anilistManga.mediaListEntry?.repeat : 0,
                                min: 0,
                                step: 1
                            }),
                            App.createDUILabel({
                                id: 'start',
                                value: this.formatFuzzyDate(anilistManga.mediaListEntry?.startedAt) ?? "??",
                                label: 'Start Date'
                            }),
                            App.createDUILabel({
                                id: 'finish',
                                value: this.formatFuzzyDate(anilistManga.mediaListEntry?.completedAt) ?? "??",
                                label: 'Finish Date'
                            }),
                        ]
                    }),
                    // Rating
                    App.createDUISection({
                        id: 'rateSection',
                        header: 'Rating',
                        footer: 'This uses your rating preference set on AniList',
                        isHidden: false,
                        rows: async () => [
                            App.createDUIStepper({
                                id: 'score',
                                label: 'Score',
                                //@ts-ignore
                                value: anilistManga.mediaListEntry?.score ?? 0,
                                min: 0,
                                max: this.scoreFormatLimit(user.mediaListOptions?.scoreFormat ?? 'POINT_10'),
                                step: user.mediaListOptions?.scoreFormat?.includes('DECIMAL') === true ? 0.1 : 1
                            })
                        ]
                    }),
                    // privacy
                    App.createDUISection({
                        id: 'privacy_settings',
                        header: 'Privacy Settings',
                        isHidden: false,
                        rows: async () => [
                            App.createDUISwitch({
                                id: 'private',
                                label: 'Private',
                                //@ts-ignore
                                value: anilistManga.mediaListEntry?.private != undefined ? anilistManga.mediaListEntry.private : ((await getDefaultPrivate(this.stateManager) == 'ADULTONLY' && anilistManga.isAdult || await getDefaultPrivate(this.stateManager) == 'ALWAYS') ? true : false)
                            }),
                            App.createDUISwitch({
                                id: 'hiddenFromStatusLists',
                                label: 'Hide From Status List',
                                //@ts-ignore
                                value: anilistManga.mediaListEntry?.hiddenFromStatusLists != undefined ? anilistManga.mediaListEntry.hiddenFromStatusLists : ((await getDefaultHideFromStatusLists(this.stateManager) == 'ADULTONLY' && anilistManga.isAdult || await getDefaultHideFromStatusLists(this.stateManager) == 'ALWAYS') ? true : false)
                            })
                        ]
                    }),
                    // Notes
                    App.createDUISection({
                        id: 'mangaNotes',
                        header: 'Notes',
                        isHidden: false,
                        rows: async () => [
                            App.createDUIInputField({
                                id: 'notes',
                                label: 'Notes',
                                //@ts-ignore
                                value: anilistManga.mediaListEntry?.notes ?? ''
                            })
                        ]
                    })
                ]
            },
            onSubmit: async (values) => {
                let mutation: GraphQLQuery
                const status = values['status']?.[0] ?? ''
                const id = tempData.id ? Number(tempData.id) : undefined //values['id'] != null ? Number(values['id']) : undefined
                const mediaId = Number(tempData.mediaId) //Number(values['mediaId'])

                let mutationData: SaveMangaProgressVariables = {}

                if (status == 'COMPLETED') {
                    if (this.reverseFormatFuzzyDate(values['finish']) == null) {
                        const now = new Date()
                        mutationData = {
                            completedAt: {
                                year: now.getFullYear(),
                                month: now.getMonth() + 1,
                                day: now.getDate()
                            }
                        }
                    }
                }

                if (status == 'NONE' && id != null) {
                    mutation = deleteMangaProgressMutation(id)
                } else {
                    mutationData = {
                        ...mutationData,
                        id: id,
                        mediaId: mediaId,
                        status: status,
                        notes: values['notes'],
                        progress: values['progress'],
                        progressVolumes: values['progressVolumes'],
                        repeat: values['repeat'],
                        private: values['private'],
                        hiddenFromStatusLists: values['hiddenFromStatusLists'],
                        score: Number(values['score']),
                    }
                    mutation = saveMangaProgressMutation(mutationData)
                }

                // console.log(JSON.stringify(mutation, null, 2)) // Log request data

                await this.requestManager.schedule(App.createRequest({
                    url: ANILIST_GRAPHQL_ENDPOINT,
                    method: 'POST',
                    data: mutation
                }), 1)
            }
        })
    }

    async getMangaDetails(mangaId: string): Promise<SourceManga> {
        const response = await this.requestManager.schedule(App.createRequest({
            url: ANILIST_GRAPHQL_ENDPOINT,
            method: 'POST',
            data: getMangaQuery(parseInt(mangaId))
        }), 1)

        const anilistManga = AnilistResult<AnilistManga.Result>(response.data).data?.Media
        if (anilistManga == null) {
            return Promise.reject()
        }

        return App.createSourceManga({
            id: mangaId,
            mangaInfo: App.createMangaInfo({
                image: anilistManga.coverImage?.extraLarge ?? '',
                titles: [
                    anilistManga.title?.romaji,
                    anilistManga.title?.english,
                    anilistManga.title?.native
                ].filter(x => x != null) as string[],
                artist: anilistManga.staff?.edges?.find(x => x?.role?.toLowerCase() == 'art')?.node?.name?.full ?? 'Unknown',
                author: anilistManga.staff?.edges?.find(x => x?.role?.toLowerCase() == 'story')?.node?.name?.full ?? 'Unknown',
                desc: anilistManga?.description || '',
                hentai: anilistManga.isAdult,
                rating: anilistManga.averageScore,
                // eslint-disable-next-line @typescript-eslint/ban-ts-comment
                // @ts-ignore
                status: anilistManga.status,
                banner: anilistManga.bannerImage
            })
        })
    }

    async getSourceMenu(): Promise<DUISection> {
        return App.createDUISection({
            id: 'sourceMenu',
            header: 'Source Menu',
            isHidden: false,
            rows: async () => {
                const isLoggedIn = await this.userInfo.isLoggedIn()
                if (isLoggedIn) {
                    return [
                        trackerSettings(this.stateManager),
                        App.createDUILabel({
                            id: 'userInfo',
                            label: 'Logged-in as',
                            value: (await this.userInfo.get())?.name ?? 'ERROR'
                        }),
                        App.createDUIButton({
                            id: 'logout',
                            label: 'Logout',
                            onTap: async () => {
                                await this.accessToken.set(undefined)
                            }
                        })
                    ]
                } else {
                    return [
                        trackerSettings(this.stateManager),
                        App.createDUIOAuthButton({
                            id: 'anilistLogin',
                            authorizeEndpoint: 'https://anilist.co/api/v2/oauth/authorize',
                            clientId: '5459',
                            label: 'Login with Anilist',
                            responseType: {
                                type: 'token'
                            },
                            successHandler: async (token) => {
                                await this.accessToken.set(token)
                            }
                        })
                    ]
                }
            }
        })
    }

    async processChapterReadActionQueue(actionQueue: TrackerActionQueue): Promise<void> {
        await this.userInfo.refresh()

        const chapterReadActions = await actionQueue.queuedChapterReadActions()

        // type PartialMediaListEntry = { mediaListEntry?: { progress?: number, progressVolumes?: number } }
        const anilistMangaCache: Record<string, AnilistManga.Media | undefined> = {}

        for (const readAction of chapterReadActions) {

            try {
                let anilistManga = anilistMangaCache[readAction.mangaId]

                if (!anilistManga) {
                    const _response = await this.requestManager.schedule(App.createRequest({
                        url: ANILIST_GRAPHQL_ENDPOINT,
                        method: 'POST',
                        data: getMangaProgressQuery(parseInt(readAction.mangaId))
                    }), 0)

                    anilistManga = AnilistResult<AnilistManga.Result>(_response.data).data?.Media
                    anilistMangaCache[readAction.mangaId] = anilistManga
                }

                if (anilistManga?.mediaListEntry) {
                    // If the Anilist chapter is higher or equal, skip
                    if (anilistManga.mediaListEntry.progress && anilistManga.mediaListEntry.progress >= Math.floor(readAction.chapterNumber)) {
                        await actionQueue.discardChapterReadAction(readAction)
                        continue
                    }
                }

                let params = {}
                if (Math.floor(readAction.chapterNumber) == 1 && !readAction.volumeNumber) {
                    params = {
                        mediaId: readAction.mangaId,
                        progress: 1,
                        progressVolumes: 1
                    }
                    
                    if (anilistManga?.mediaListEntry?.startedAt == null) {
                        const now = new Date()
                        params = {
                            ...params,
                            startedAt: {
                                year: now.getFullYear(),
                                month: now.getMonth() + 1,
                                day: now.getDate()
                            }
                        }
                    }
                } else {
                    params = {
                        mediaId: readAction.mangaId,
                        progress: Math.floor(readAction.chapterNumber),
                        progressVolumes: readAction.volumeNumber ? Math.floor(readAction.volumeNumber) : undefined
                    }
                }

                const response = await this.requestManager.schedule(App.createRequest({
                    url: ANILIST_GRAPHQL_ENDPOINT,
                    method: 'POST',
                    data: saveMangaProgressMutation(params)
                }), 0)

                if (response.status < 400) {
                    await actionQueue.discardChapterReadAction(readAction)
                    anilistMangaCache[readAction.mangaId] = {
                        mediaListEntry: {
                            progress: Math.floor(readAction.chapterNumber),
                            progressVolumes: readAction.volumeNumber ? Math.floor(readAction.volumeNumber) : undefined
                        }
                    }
                } else {
                    console.log(`Action failed: ${response.data}`)
                    await actionQueue.retryChapterReadAction(readAction)
                }

            } catch (error) {
                console.log(error)
                await actionQueue.retryChapterReadAction(readAction)
            }
        }
    }

    // Utility
    scoreFormatLimit(format: AnilistUser.ScoreFormat): number | undefined {
        const extracted = /\d+/gi.exec(format)?.[0]
        return extracted != null ? Number(extracted) : undefined
    }

    formatStatus(value: string | undefined): string {
        switch (value) {
            case 'CURRENT': return 'Reading'
            case 'PLANNING': return 'Planned'
            case 'COMPLETED': return 'Completed'
            case 'DROPPED': return 'Dropped'
            case 'PAUSED': return 'On-Hold'
            case 'REPEATING': return 'Re-Reading'

            case 'FINISHED': return 'Finished'
            case 'RELEASING': return 'Releasing'
            case 'NOT_YET_RELEASED': return 'Not Yet Released'
            case 'CANCELLED': return 'Cancelled'
            case 'HIATUS': return 'Hiatus'

            case 'NONE': return 'None'
            default: return 'N/A'
        }
    }

    formatFuzzyDate(date: AnilistManga.FuzzyDate | undefined): string | null {
        if (date == null) {
            return null
        }

        const formattedMonth = date.month != null && date.month < 10 ? `0${date.month}` : date.month ?? '??'
        const formattedDay = date.day != null && date.day < 10 ? `0${date.day}` : date.day ?? '??'
        return `${date.year ?? '??'}-${formattedMonth}-${formattedDay}`
    }

    reverseFormatFuzzyDate(dateString: string | undefined): AnilistManga.FuzzyDate | null {
        if (dateString == null) {
            return null
        }

        const [year, month, day] = dateString.split('-').map(part => part === '??' ? undefined : parseInt(part))
        return {
            year: year,
            month: month,
            day: day
        }
    }

    // formatAppleUnixTime(time: number): string {
    //     const date = new Date(time * 1000)
    //     const year = date.getUTCFullYear()
    //     const month = (date.getUTCMonth() + 1).toString().padStart(2, '0')
    //     const day = date.getUTCDate().toString().padStart(2, '0')
    //     return `${year}-${month}-${day}`
    // }

}
