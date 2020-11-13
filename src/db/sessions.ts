/* eslint-disable @typescript-eslint/camelcase */
import { v4 as uuidv4 } from 'uuid'

import sessiondb from 'resources/sessions'

import { ResultAsync, okAsync, errAsync } from 'neverthrow'
import { DateTime } from 'luxon'
import * as Errors from 'errors'
import { Admin, UUID } from './types'
import { getAdmin } from './actions'

type RouteError = Errors.RouteError

// remove any past sessions pertaining to user
export const initAdminSession = ({
  id,
}: Admin): ResultAsync<UUID, RouteError> => {
  const uuid = uuidv4()

  sessiondb.set(uuid, {
    adminId: id,
    last_accessed_at: new Date(),
  })

  return okAsync(uuid)
}

export const getAdminFromSession = (
  sessionId: UUID
): ResultAsync<Admin, RouteError> => {
  const adminSession = sessiondb.get(sessionId)

  if (!adminSession) {
    return errAsync(Errors.notFound())
  }

  const now = DateTime.local()
  const lastAccessed = DateTime.fromJSDate(adminSession.last_accessed_at)
  const sessionExpired = lastAccessed.diff(now).days > 7

  if (sessionExpired) {
    return errAsync(Errors.invalidSession())
  }

  return getAdmin(adminSession.adminId)
}
