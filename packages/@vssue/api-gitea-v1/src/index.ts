import { VssueAPI } from 'vssue'

import axios, {
  AxiosInstance,
  AxiosRequestConfig,
} from 'axios'

import {
  buildQuery,
  buildURL,
  concatURL,
  getCleanURL,
  parseQuery,
} from '@vssue/utils'

import {
  normalizeUser,
  normalizeIssue,
  normalizeComment,
} from './utils'

/**
 * Gitea API V1
 *
 * @see https://docs.gitea.io/en-us/api-usage
 * @see https://try.gitea.io/api/swagger
 */
export default class GiteaV1 implements VssueAPI.Instance {
  baseURL: string
  owner: string
  repo: string
  labels: Array<string>
  clientId: string
  clientSecret: string
  state: string
  proxy: string | ((url: string) => string)
  $http: AxiosInstance

  constructor ({
    baseURL = 'https://try.gitea.io',
    owner,
    repo,
    labels,
    clientId,
    clientSecret,
    state,
    proxy,
  }: VssueAPI.Options) {
    this.baseURL = baseURL
    this.owner = owner
    this.repo = repo
    this.labels = labels

    this.clientId = clientId
    this.clientSecret = clientSecret
    this.state = state
    this.proxy = proxy

    this.$http = axios.create({
      baseURL: concatURL(baseURL, 'api/v1'),
      headers: {
        'Accept': 'application/json',
      },
    })
  }

  /**
   * The platform api info
   */
  get platform (): VssueAPI.Platform {
    return {
      name: 'Gitea',
      link: this.baseURL,
      version: '',
      meta: {
        reactable: true,
        sortable: false,
      },
    }
  }

  /**
   * Redirect to the authorization page of platform.
   *
   * @see
   */
  redirectAuth (): void {
    window.location.href = buildURL(concatURL(this.baseURL, 'site/oauth2/authorize'), {
      client_id: this.clientId,
      redirect_uri: window.location.href,
      response_type: 'code',
    })
  }

  /**
   * Handle authorization.
   *
   * @return A string for access token, `null` for no authorization code
   *
   * @see
   *
   * @remarks
   * If the `code` exists in the query, remove them from query, and try to get the access token.
   */
  async handleAuth (): Promise<VssueAPI.AccessToken> {
    const query = parseQuery(window.location.search)
    if (query.code) {
      const code = query.code
      delete query.code
      const replaceURL = buildURL(getCleanURL(window.location.href), query) + window.location.hash
      window.history.replaceState(null, '', replaceURL)
      const accessToken = await this.getAccessToken({ code })
      return accessToken
    }
    return null
  }

  /**
   * Get user access token via `code`
   *
   * @param options.code - The code from the query
   *
   * @return User access token
   *
   * @see
   */
  async getAccessToken ({
    code,
  }: {
    code: string
  }): Promise<string> {
    const originalURL = concatURL(this.baseURL, 'site/oauth2/access_token')
    const proxyURL = typeof this.proxy === 'function'
      ? this.proxy(originalURL)
      : this.proxy
    const { data } = await this.$http.post(proxyURL, buildQuery({
      grant_type: 'authorization_code',
      redirect_uri: window.location.href,
      code,
    }), {
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      auth: {
        username: this.clientId,
        password: this.clientSecret,
      },
    })
    return data.access_token
  }

  /**
   * Get the logined user with access token.
   *
   * @param options.accessToken - User access token
   *
   * @return The user
   *
   * @see https://try.gitea.io/api/swagger#/user/userGetCurrent
   */
  async getUser ({
    accessToken,
  }: {
    accessToken: VssueAPI.AccessToken
  }): Promise<VssueAPI.User> {
    const { data } = await this.$http.get('user', {
      headers: { 'Authorization': `token ${accessToken}` },
    })
    return normalizeUser(data, this.baseURL)
  }

  /**
   * Get issue of this page according to the issue id or the issue title
   *
   * @param options.accessToken - User access token
   * @param options.issueId - The id of issue
   * @param options.issueTitle - The title of issue
   *
   * @return The raw response of issue
   *
   * @see https://try.gitea.io/api/swagger#/issue/issueListIssues
   * @see https://try.gitea.io/api/swagger#/issue/issueGetIssue
   */
  async getIssue ({
    accessToken,
    issueId,
    issueTitle,
  }: {
    accessToken: VssueAPI.AccessToken
    issueId?: string | number
    issueTitle?: string
  }): Promise<VssueAPI.Issue | null> {
    const options: AxiosRequestConfig = {}

    if (accessToken) {
      options.headers = {
        'Authorization': `token ${accessToken}`,
      }
    }

    if (issueId) {
      try {
        options.params = {
          // to avoid caching
          timestamp: Date.now(),
        }
        const { data } = await this.$http.get(`repos/${this.owner}/${this.repo}/issues/${issueId}`, options)
        return normalizeIssue(data, this.baseURL, this.owner, this.repo)
      } catch (e) {
        if (e.response && e.response.status === 404) {
          return null
        } else {
          throw e
        }
      }
    } else {
      options.params = {
        labels: this.labels.join(','),
        q: issueTitle,
        // to avoid caching
        timestamp: Date.now(),
      }
      const { data } = await this.$http.get(`repos/${this.owner}/${this.repo}/issues`, options)
      return data.size > 0 ? normalizeIssue(data.values[0], this.baseURL, this.owner, this.repo) : null
    }
  }

  /**
   * Create a new issue
   *
   * @param options.accessToken - User access token
   * @param options.title - The title of issue
   * @param options.content - The content of issue
   *
   * @return The created issue
   *
   * @see https://try.gitea.io/api/swagger#/issue/issueCreateIssue
   */
  async postIssue ({
    accessToken,
    title,
    content,
  }: {
    accessToken: VssueAPI.AccessToken
    title: string
    content: string
  }): Promise<VssueAPI.Issue> {
    const { data } = await this.$http.post(`repos/${this.owner}/${this.repo}/issues`, {
      body: {
        title,
        body: content,
        labels: this.labels,
      },
    }, {
      headers: { 'Authorization': `token ${accessToken}` },
    })
    return normalizeIssue(data, this.baseURL, this.owner, this.repo)
  }

  /**
   * Get comments of this page according to the issue id
   *
   * @param options.accessToken - User access token
   * @param options.issueId - The id of issue
   * @param options.query - The query parameters
   *
   * @return The comments
   *
   * @see https://try.gitea.io/api/swagger#/issue/issueGetComments
   */
  async getComments ({
    accessToken,
    issueId,
    query: {
      page = 1,
      perPage = 10,
      sort = 'desc',
    } = {},
  }: {
    accessToken: VssueAPI.AccessToken
    issueId: string | number
    query?: Partial<VssueAPI.Query>
  }): Promise<VssueAPI.Comments> {
    const options: AxiosRequestConfig = {
      params: {
        // to avoid caching
        timestamp: Date.now(),
      },
    }
    if (accessToken) {
      options.headers = {
        'Authorization': `token ${accessToken}`,
      }
    }
    const response = await this.$http.get(`repos/${this.owner}/${this.repo}/issues/${issueId}/comments`, options)
    const commentsRaw = response.data

    // gitea api v1 should get reactions by other api
    // this is potentially to cause 429 Too Many Requests
    const getCommentsMeta: Array<Promise<void>> = []

    for (const comment of commentsRaw) {
      // gitea api v1 cannot get parsed markdown content for now

      // getCommentsMeta.push((async () => {
      //   comment.body_html = await this.getMarkdownContent({
      //     accessToken: accessToken,
      //     contentRaw: comment.body,
      //   })
      // })())
      getCommentsMeta.push((async () => {
        comment.reactions = await this.getCommentReactions({
          accessToken: accessToken,
          issueId: issueId,
          commentId: comment.id,
        })
      })())
    }

    await Promise.all(getCommentsMeta)

    return {
      // gitea api v1 does not support pagination for now
      count: 0,
      page: 0,
      perPage: 0,
      data: commentsRaw.map(normalizeComment),
    }
  }

  /**
   * Create a new comment
   *
   * @param options.accessToken - User access token
   * @param options.issueId - The id of issue
   * @param options.content - The content of comment
   *
   * @return The created comment
   *
   * @see https://try.gitea.io/api/swagger#/issue/issueCreateComment
   */
  async postComment ({
    accessToken,
    issueId,
    content,
  }: {
    accessToken: VssueAPI.AccessToken
    issueId: string | number
    content: string
  }): Promise<VssueAPI.Comment> {
    const { data } = await this.$http.post(`repos/${this.owner}/${this.repo}/issues/${issueId}/comments`, {
      body: {
        body: content,
      },
    }, {
      headers: { 'Authorization': `token ${accessToken}` },
    })
    return normalizeComment(data, this.baseURL)
  }

  /**
   * Edit a comment
   *
   * @param options.accessToken - User access token
   * @param options.issueId - The id of issue
   * @param options.commentId - The id of comment
   * @param options.content - The content of comment
   *
   * @return The edited comment
   *
   * @see https://try.gitea.io/api/swagger#/issue/issueEditCommentDeprecated
   */
  async putComment ({
    accessToken,
    issueId,
    commentId,
    content,
  }: {
    accessToken: VssueAPI.AccessToken
    issueId: string | number
    commentId: string | number
    content: string
  }): Promise<VssueAPI.Comment> {
    const { data } = await this.$http.patch(`repos/${this.owner}/${this.repo}/issues/${issueId}/comments/${commentId}`, {
      body: {
        body: content,
      },
    }, {
      headers: { 'Authorization': `token ${accessToken}` },
    })
    return normalizeComment(data, this.baseURL)
  }

  /**
   * Delete a comment
   *
   * @param options.accessToken - User access token
   * @param options.issueId - The id of issue
   * @param options.commentId - The id of comment
   *
   * @return `true` if succeed, `false` if failed
   *
   * @see https://try.gitea.io/api/swagger#/issue/issueDeleteCommentDeprecated
   */
  async deleteComment ({
    accessToken,
    issueId,
    commentId,
  }: {
    accessToken: VssueAPI.AccessToken
    issueId: string | number
    commentId: string | number
  }): Promise<boolean> {
    const { status } = await this.$http.delete(`repos/${this.owner}/${this.repo}/issues/${issueId}/comments/${commentId}`, {
      headers: { 'Authorization': `token ${accessToken}` },
    })
    return status === 204
  }

  /**
   * Get reactions of a comment
   *
   * @param options.accessToken - User access token
   * @param options.issueId - The id of issue
   * @param options.commentId - The id of comment
   *
   * @return The comments
   *
   * @see
   */
  async getCommentReactions ({
    accessToken,
    issueId,
    commentId,
  }: {
    accessToken: VssueAPI.AccessToken
    issueId: string | number
    commentId: string | number
  }): Promise<VssueAPI.Reactions> {
    throw new Error('501 Not Implemented')
  }

  /**
   * Create a new reaction of a comment
   *
   * @param options.accessToken - User access token
   * @param options.issueId - The id of issue
   * @param options.commentId - The id of comment
   * @param options.reaction - The reaction
   *
   * @return `true` if succeed, `false` if already token
   *
   * @see
   */
  async postCommentReaction ({
    issueId,
    commentId,
    reaction,
    accessToken,
  }: {
    accessToken: VssueAPI.AccessToken
    issueId: string | number
    commentId: string | number
    reaction: keyof VssueAPI.Reactions
  }): Promise<boolean> {
    throw new Error('501 Not Implemented')
  }
}
