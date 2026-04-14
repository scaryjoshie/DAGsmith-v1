def process(customer):
    return customer


def branch(customer):
    return "valid" if customer.get("email") else "invalid"
