import { Body, Controller, Delete, Get, HttpCode, HttpStatus, Param, ParseIntPipe, Post } from '@nestjs/common';
import { Type } from 'class-transformer';
import { IsIn, IsInt, IsNumber, IsOptional, Matches, Max, Min } from 'class-validator';
import { AppError, CurrentUser, Public, type AuthUser } from '../common/common';
import { RocketService } from './rocket.service';

class BetDto {
  @Type(() => Number) @IsIn([1, 2]) slot!: number;
  /** Birr, up to 2 decimals: "10" or "12.50". */
  @Matches(/^\d{1,7}(\.\d{1,2})?$/, { message: 'Amount in birr, e.g. 10 or 12.50' }) amount!: string;
  /** Auto cash out at this multiplier, e.g. 2.5. Leave out for manual only. */
  @IsOptional() @Type(() => Number) @IsNumber({ maxDecimalPlaces: 2 }) @Min(1.01) @Max(1000) autoX?: number;
}
class SlotDto {
  @Type(() => Number) @IsInt() @IsIn([1, 2]) slot!: number;
}

const toMinor = (birr: string) => {
  const [w, f = ''] = birr.split('.');
  return BigInt(w) * 100n + BigInt((f + '00').slice(0, 2));
};

/** Leyu Rocket for players. Live updates come over the socket (`rocket:join`, then `rocket` events). */
@Controller('rocket')
export class RocketController {
  constructor(private readonly rocket: RocketService) {}

  @Public()
  @Get('state')
  state() {
    return this.rocket.publicState();
  }

  @Get('my')
  my(@CurrentUser() auth: AuthUser) {
    return this.rocket.myBets(auth.id);
  }

  @Post('bet')
  @HttpCode(HttpStatus.OK)
  bet(@CurrentUser() auth: AuthUser, @Body() body: BetDto) {
    const stake = toMinor(body.amount);
    if (stake <= 0n) throw new AppError(HttpStatus.BAD_REQUEST, 'BAD_STAKE', 'Enter an amount.');
    return this.rocket.bet(auth.id, body.slot, stake, body.autoX ? Math.round(body.autoX * 100) : null);
  }

  @Post('cashout')
  @HttpCode(HttpStatus.OK)
  cashOut(@CurrentUser() auth: AuthUser, @Body() body: SlotDto) {
    return this.rocket.cashOut(auth.id, body.slot);
  }

  @Delete('bet/:slot')
  cancel(@CurrentUser() auth: AuthUser, @Param('slot', ParseIntPipe) slot: number) {
    return this.rocket.cancel(auth.id, slot);
  }

  /** Anyone can check a finished round: sha256(serverSeed) = seedHash, and the crash point follows from the seed. */
  @Public()
  @Get('verify/:number')
  verify(@Param('number', ParseIntPipe) number: number) {
    return this.rocket.verify(number);
  }
}
