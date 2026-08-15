#[cfg(test)]
mod tests {
    use core::poseidon::poseidon_hash_span;
    use snforge_std::fs::{FileTrait, read_txt};

    /// Felts per vector in commitments_flat.txt, in fixture order.
    const STRIDE: usize = 7;

    /// Poseidon parity against the TypeScript side.
    ///
    /// Reads the fixture generated from contracts/test_vectors/commitments.json
    /// by `npm run vectors:emit`, recomputes both hashes in Cairo, and requires
    /// them to equal what starknet.js produced. Expected values come from the
    /// file, never from a Cairo-side recomputation, so this cannot pass by
    /// agreeing with itself.
    ///
    /// Encoding, fixed in ARCHITECTURE.md section 4: u256 amounts hash as two
    /// felts, low limb first. Addresses are single felts.
    #[test]
    fn poseidon_parity_with_starknet_js() {
        let file = FileTrait::new("test_vectors/commitments_flat.txt");
        let data = read_txt(@file);

        assert(data.len() % STRIDE == 0, 'fixture not a multiple of 7');
        assert(data.len() > 0, 'fixture is empty');

        let count = data.len() / STRIDE;
        let mut i: usize = 0;

        while i != count {
            let base = i * STRIDE;
            let amount_low = *data.at(base);
            let amount_high = *data.at(base + 1);
            let bid_salt = *data.at(base + 2);
            let claim_secret = *data.at(base + 3);
            let payout_address = *data.at(base + 4);
            let expected_handle = *data.at(base + 5);
            let expected_commitment = *data.at(base + 6);

            let handle = poseidon_hash_span([claim_secret, payout_address].span());
            assert(handle == expected_handle, 'claim_handle mismatch');

            let commitment = poseidon_hash_span(
                [amount_low, amount_high, bid_salt, handle].span(),
            );
            assert(commitment == expected_commitment, 'bid_commitment mismatch');

            i += 1;
        }
    }
}
