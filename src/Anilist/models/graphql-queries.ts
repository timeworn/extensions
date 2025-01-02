export interface FuzzyDateInput {
    year?: string
    month?: string
    day?: string
}

export interface GraphQLQuery {
    query: string
    variables?: unknown
}

export const userProfileQuery = (): GraphQLQuery => ({
    query: `{
        Viewer {
            id
            name
            avatar {
                large
            }
            mediaListOptions {
                scoreFormat
            }
            siteUrl
        }
    }`
})

export const searchMangaQuery = (page: number, search: string): GraphQLQuery => ({
    query: `query($page: Int, $search: String) {
        Page(page: $page) {
            pageInfo {
                currentPage
                hasNextPage
            }
            media(type: MANGA, search: $search, format_not: NOVEL) {
                id
                title {
                    userPreferred
                }
                coverImage {
                    large
                }
            }
        }
    }`,
    variables: {
        page,
        search
    }
})

export const getMangaQuery = (id: number): GraphQLQuery => ({
    query: `query($id: Int){
        Media(id: $id){
            id
            description(asHtml: false)
            title {
                romaji
                english
                native
            }
            coverImage{
                extraLarge
            }
            bannerImage
            averageScore
            isAdult
            popularity
            characters(sort: RELEVANCE, perPage: 25) {
                edges {
                    node {
                        image {
                            large
                        }
                        age
                    }
                    name
                    role
                }
            }
            staff {
                edges {
                    node {
                        name {
                            full
                        }
                        image {
                            large
                        }
                    }
                    role
                }
            }
            status
        }
    }`,
    variables: {
        id
    }
})

export const getMangaProgressQuery = (id: number): GraphQLQuery => ({
    query: `query($id: Int) {
        Media(id: $id) {
            id
            mediaListEntry {
                id
                status
                progress
                progressVolumes
                repeat
                private
                hiddenFromStatusLists
                score
                notes
                startedAt {
                    year
                    month
                    day
                }
                completedAt {
                    year
                    month
                    day
                }
            }
            title {
                romaji
                english
                native
                userPreferred
            }
            coverImage {
                extraLarge
            }
            bannerImage
            averageScore
            isAdult
            popularity
            status
        }
    }`,
    variables: {
        id
    }
})

export interface SaveMangaProgressVariables {
    id?: number;
    mediaId?: number | string;
    status?: string;
    score?: number;
    private?: boolean;
    hiddenFromStatusLists?: boolean;
    progress?: number;
    progressVolumes?: number;
    repeat?: number,
    notes?: string;
    startedAt?: FuzzyDateInput,
    completedAt?: FuzzyDateInput,
}


export const saveMangaProgressMutation = (variables: SaveMangaProgressVariables): GraphQLQuery => ({
    // query: `mutation($id: Int, $mediaId: Int, $status: MediaListStatus, $score: Float, $progress: Int, $progressVolumes: Int, $repeat: Int, $notes: String, $private: Boolean, $hiddenFromStatusLists: Boolean, $startedAt: FuzzyDateInput, $completedAt: FuzzyDateInput) {
    //     SaveMediaListEntry(id: $id, mediaId: $mediaId, status: $status, score: $score, progress: $progress, progressVolumes: $progressVolumes, repeat: $repeat, notes: $notes, private: $private, hiddenFromStatusLists: $hiddenFromStatusLists, startedAt: $startedAt, completedAt: $completedAt){
    //         id
    // }`,
    // variables: variables
    query: `mutation($id:Int $mediaId:Int $status:MediaListStatus $score:Float $progress:Int $progressVolumes:Int $repeat:Int $private:Boolean $notes:String $customLists:[String]$hiddenFromStatusLists:Boolean $advancedScores:[Float]$startedAt:FuzzyDateInput $completedAt:FuzzyDateInput){SaveMediaListEntry(id:$id mediaId:$mediaId status:$status score:$score progress:$progress progressVolumes:$progressVolumes repeat:$repeat private:$private notes:$notes customLists:$customLists hiddenFromStatusLists:$hiddenFromStatusLists advancedScores:$advancedScores startedAt:$startedAt completedAt:$completedAt){id mediaId status score advancedScores progress progressVolumes repeat priority private hiddenFromStatusLists customLists notes updatedAt startedAt{year month day}completedAt{year month day}user{id name}media{id title{userPreferred}coverImage{large}type format status episodes volumes chapters averageScore popularity isAdult startDate{year}}}}`,
    variables: variables
})

export const deleteMangaProgressMutation = (id: number): GraphQLQuery => ({
    query: `mutation($id: Int) {
        DeleteMediaListEntry(id: $id){
            deleted
        }
    }`,
    variables: {
        id
    }
})
