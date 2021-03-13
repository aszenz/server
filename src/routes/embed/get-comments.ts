import { route, AppData } from 'router'

import { ResultAsync } from 'neverthrow'
import * as rt from 'runtypes'
import {
  Comment,
  Id,
  canonicalId,
  CanonicalId,
  Cuid,
  cuid,
  Site,
} from 'db/types'
import { commentTreeLeafState } from 'db/comment-cache'
import { decode } from 'routes/parser'
import { findOrCreatePost, getComments, getSingleSite } from 'db/actions'
import * as Errors from 'errors'
import { FlattenedComment } from '../output'
import { omit } from 'utils'
import { postIdDecoder, cuidDecoder } from 'routes/parser-utils'

type RouteError = Errors.RouteError

// RecursiveCommentTree is a comment with an indefinite level of nested replies / comments
type RecursiveCommentTree = Comment.WithRepliesAndAuthor[]

type CommentsMap = Record<Comment['id'], FlattenedComment>

interface CommentResponse {
  comments: CommentsMap
  topLevelComments: Array<Comment['id']>
  postId: Site['id']
}

const flattenRecursiveCommentTree = (
  tree: RecursiveCommentTree,
  postId: Cuid,
  leafIds: Array<Comment['id']>
): CommentsMap =>
  tree.reduce((flattened, comment) => {
    const [replyIds, flattenedReplies] = comment.replies
      ? // note that these operations are _NOT_ running in parallel.
        // they are running sequentially.
        [
          comment.replies.map(({ id }) => id),
          flattenRecursiveCommentTree(comment.replies, postId, leafIds),
        ]
      : [[], {} as CommentsMap]

    const withoutReplies = omit(comment, ['replies'])

    const flattenedComment: FlattenedComment = {
      ...withoutReplies,
      replyIds,
      isLeaf: leafIds.includes(withoutReplies.id),
    }

    return {
      ...flattened,
      ...flattenedReplies,
      [flattenedComment.id]: flattenedComment,
    }
  }, {})

type GetSiteComments = Omit<CommentResponse, 'interactions'>

const getSiteComments = (
  siteId: Id,
  postId: CanonicalId,
  parentCommentId?: Cuid
): ResultAsync<GetSiteComments, RouteError> =>
  getSingleSite(siteId)
    .andThen((site) =>
      findOrCreatePost(postId, cuid(site.id)).map((post) => ({ post, site }))
    )
    .andThen(({ post, site }) => {
      const filters = {
        postId: post.id,
        parentCommentId: parentCommentId?.val,
      }

      return getComments(site.id, filters).map((comments) => {
        const postCuid = cuid(post.id)
        const leafIds = commentTreeLeafState.getLeafCommentsForPost(postCuid)
        const commentsMap = flattenRecursiveCommentTree(
          comments,
          postCuid,
          leafIds
        )
        const topLevelComments = comments.map(({ id }) => id)

        return {
          comments: commentsMap,
          postId: post.id,
          topLevelComments,
        }
      })
    })

const requestParamsDecoder = (hostname: string) =>
  rt.Record({
    //////////////////
    // route params
    siteId: rt.String,

    //////////////////
    // query params
    parentCommentId: cuidDecoder.Or(rt.Undefined),
    postId: postIdDecoder(hostname),
  })

export const handler = route<CommentResponse>((req, _) =>
  decode(
    requestParamsDecoder(req.hostname),
    { ...req.params, ...req.query },
    'invalid data'
  ).map(({ siteId, postId, parentCommentId }) => {
    // currently assuming that the site id is always a hostname
    // and not a CUID, hence why i'm passing in siteId to create a
    // canonical id
    //
    // assuming postID is a path for now as well
    const siteId_ = canonicalId(siteId)
    const postId_ = canonicalId(postId)
    const parentCommentId_ = parentCommentId ? cuid(parentCommentId) : undefined

    return getSiteComments(siteId_, postId_, parentCommentId_).map(AppData.init)
  })
)
