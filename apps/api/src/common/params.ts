import { HttpStatus, ParseUUIDPipe } from '@nestjs/common';

/** Path ids that are not valid UUIDs cannot exist: 404, like any other unknown id. */
export const uuidParam = () => new ParseUUIDPipe({ errorHttpStatusCode: HttpStatus.NOT_FOUND });
