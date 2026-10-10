import {it,expect} from 'vitest';
import {confirmsField} from '../shared/field-location';

it('accepts natural spoken field confirmations including the reported phrases',()=>{
 for(const text of ['जी यही मेरा खेत है।','जी हाँ यही खेत है।','जी, हाँ, यही मेरा खेत है।','हाँ यही खेत है','हां मेरा खेत यही है','यहीं मेरा खेत है','जी यही हमारा खेत है','हाँ यही मेरा खेत है, अनुरोध भेज दीजिए।','हाँ भेज दो','जी हाँ','जी','yes this is my field'])expect(confirmsField(text),text).toBe(true);
});
it('does not send on a question, correction, refusal or location-permission sentence',()=>{
 for(const text of ['नहीं','जी नहीं यही मेरा खेत नहीं है','हाँ लेकिन यह मेरा खेत नहीं है','जी यही मेरा खेत है?','क्या यही मेरा खेत है','हाँ यही मेरा खेत है लेकिन रकबा बदलना है','हाँ मत भेजो','हाँ लोकेशन की अनुमति है','शायद यही मेरा खेत है','यह मेरा खेत नहीं है','जी यही मेरा खेत है अभी मत भेजिए'])expect(confirmsField(text),text).toBe(false);
});
