'use client';

import {useEffect} from 'react';
import {NockPhoneController} from '../src/game/ui/nock-phone-controller.ts';

export function PhoneRuntimeMount(): null {
  useEffect(() => {
    const phone = NockPhoneController.forDocument();
    return () => {
      phone.destroy();
    };
  }, []);

  return null;
}
